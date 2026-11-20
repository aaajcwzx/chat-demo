package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/flipped-aurora/gin-vue-admin/server/global"
	coreModel "github.com/flipped-aurora/gin-vue-admin/server/model/system"
	coreRequest "github.com/flipped-aurora/gin-vue-admin/server/model/system/request"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model"
	chatRequest "github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model/request"
	coreService "github.com/flipped-aurora/gin-vue-admin/server/service/system"
	"github.com/flipped-aurora/gin-vue-admin/server/utils"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const ChatRoleID uint = 1111
const SessionCookie = "chat-session"

type AuthService struct{}
type Member struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Admin    bool   `json:"admin"`
}
type Claims struct {
	coreRequest.CustomClaims
	CredentialStamp string `json:"credentialStamp"`
}

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{2,31}$`)

func member(user coreModel.SysUser) Member {
	admin := user.AuthorityId == 888
	for _, role := range user.Authorities {
		if role.AuthorityId == 888 {
			admin = true
		}
	}
	return Member{ID: user.ID, Username: user.Username, Nickname: user.NickName, Admin: admin}
}
func credentialStamp(hash string) string {
	m := hmac.New(sha256.New, []byte(global.GVA_CONFIG.JWT.SigningKey))
	m.Write([]byte(hash))
	return hex.EncodeToString(m.Sum(nil))
}
func tokenDigest(token string) string {
	value := sha256.Sum256([]byte(token))
	return hex.EncodeToString(value[:])
}
func (s *AuthService) issue(user coreModel.SysUser) (string, time.Time, error) {
	base := utils.NewJWT().CreateClaims(coreRequest.BaseClaims{UUID: user.UUID, ID: user.ID, Username: user.Username, NickName: user.NickName, AuthorityId: user.AuthorityId})
	base.RegisteredClaims.ID = uuid.NewString()
	base.IssuedAt = jwt.NewNumericDate(time.Now())
	claims := Claims{CustomClaims: base, CredentialStamp: credentialStamp(user.Password)}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(global.GVA_CONFIG.JWT.SigningKey))
	return token, base.ExpiresAt.Time, err
}
func (s *AuthService) Login(ctx context.Context, input chatRequest.Login) (Member, string, time.Time, error) {
	if len(input.Password) > 72 {
		return Member{}, "", time.Time{}, ErrUnauthenticated
	}
	u, err := coreService.UserServiceApp.Login(&coreModel.SysUser{Username: strings.ToLower(strings.TrimSpace(input.Username)), Password: input.Password})
	if err != nil || u.Enable != 1 {
		return Member{}, "", time.Time{}, ErrUnauthenticated
	}
	token, expiry, err := s.issue(*u)
	return member(*u), token, expiry, err
}
func (s *AuthService) Register(ctx context.Context, input chatRequest.Register) (Member, string, time.Time, error) {
	name := strings.ToLower(strings.TrimSpace(input.Username))
	if !usernamePattern.MatchString(name) || len(input.Password) < 8 || len(input.Password) > 72 || len(input.Nickname) > 160 {
		return Member{}, "", time.Time{}, ErrInvalid
	}
	if config.Current.InviteCode == "" || subtle.ConstantTimeCompare([]byte(input.InviteCode), []byte(config.Current.InviteCode)) != 1 {
		return Member{}, "", time.Time{}, errors.New("邀请码不正确，请向管理员获取")
	}
	var role coreModel.SysAuthority
	if err := global.GVA_DB.WithContext(ctx).First(&role, "authority_id = ?", ChatRoleID).Error; err != nil {
		return Member{}, "", time.Time{}, err
	}
	u, err := coreService.UserServiceApp.Register(coreModel.SysUser{Username: name, Password: input.Password, NickName: input.Nickname, Enable: 1, AuthorityId: ChatRoleID, Authorities: []coreModel.SysAuthority{role}})
	if err != nil {
		return Member{}, "", time.Time{}, errors.New("无法注册，请检查用户名是否已使用")
	}
	token, expiry, err := s.issue(u)
	return member(u), token, expiry, err
}
func (s *AuthService) Current(ctx context.Context, token string) (Member, error) {
	if token == "" || len(token) > 8192 {
		return Member{}, ErrUnauthenticated
	}
	claims := new(Claims)
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) { return []byte(global.GVA_CONFIG.JWT.SigningKey), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(global.GVA_CONFIG.JWT.Issuer), jwt.WithAudience("GVA"))
	if err != nil || !parsed.Valid || claims.BaseClaims.ID == 0 {
		return Member{}, ErrUnauthenticated
	}
	var revoked int64
	if err = global.GVA_DB.WithContext(ctx).Model(&model.RevokedToken{}).Where("digest = ?", tokenDigest(token)).Count(&revoked).Error; err != nil {
		return Member{}, err
	}
	if revoked > 0 {
		return Member{}, ErrUnauthenticated
	}
	var user coreModel.SysUser
	if err = global.GVA_DB.WithContext(ctx).Preload("Authorities").First(&user, claims.BaseClaims.ID).Error; err != nil || user.Enable != 1 {
		return Member{}, ErrUnauthenticated
	}
	if subtle.ConstantTimeCompare([]byte(claims.CredentialStamp), []byte(credentialStamp(user.Password))) != 1 {
		return Member{}, ErrUnauthenticated
	}
	return member(user), nil
}
func (s *AuthService) Logout(ctx context.Context, token string) error {
	claims := new(Claims)
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) { return []byte(global.GVA_CONFIG.JWT.SigningKey), nil }, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || claims.ExpiresAt == nil {
		return nil
	}
	return global.GVA_DB.WithContext(ctx).Where(model.RevokedToken{Digest: tokenDigest(token)}).FirstOrCreate(&model.RevokedToken{Digest: tokenDigest(token), ExpiresAt: claims.ExpiresAt.Time}).Error
}
func (s *AuthService) ChangePassword(ctx context.Context, who Member, input chatRequest.ChangePassword) (string, time.Time, error) {
	if len(input.NewPassword) < 8 || len(input.NewPassword) > 72 {
		return "", time.Time{}, ErrInvalid
	}
	if err := coreService.UserServiceApp.ChangePassword(&coreModel.SysUser{GVA_MODEL: global.GVA_MODEL{ID: who.ID}, Password: input.OldPassword}, input.NewPassword); err != nil {
		return "", time.Time{}, errors.New("原密码不正确")
	}
	var user coreModel.SysUser
	if err := global.GVA_DB.WithContext(ctx).Preload("Authorities").First(&user, who.ID).Error; err != nil {
		return "", time.Time{}, err
	}
	return s.issue(user)
}

func SeedAccounts(adminPassword, userPassword string) error {
	var count int64
	if err := global.GVA_DB.Model(&coreModel.SysUser{}).Where("username = ?", "admin").Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		if err := new(coreService.InitDBService).InitExistingDB(global.GVA_DB, adminPassword); err != nil {
			return err
		}
		if err := global.GVA_DB.Model(&coreModel.SysUser{}).Where("username = ?", "a303176530").Update("enable", 2).Error; err != nil {
			return err
		}
	}
	role := coreModel.SysAuthority{AuthorityId: ChatRoleID, AuthorityName: "聊天用户", DefaultRouter: "dashboard"}
	if err := global.GVA_DB.Where("authority_id = ?", ChatRoleID).FirstOrCreate(&role).Error; err != nil {
		return err
	}
	if err := global.GVA_DB.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_username_unique ON sys_users (lower(username)) WHERE deleted_at IS NULL").Error; err != nil {
		return err
	}
	var user coreModel.SysUser
	err := global.GVA_DB.Where("username = ?", "chat").First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if len(userPassword) < 16 {
			return errors.New("a strong initial chat-user password is required")
		}
		_, err = coreService.UserServiceApp.Register(coreModel.SysUser{Username: "chat", Password: userPassword, NickName: "聊天用户", Enable: 1, AuthorityId: ChatRoleID, Authorities: []coreModel.SysAuthority{role}})
	}
	return err
}
