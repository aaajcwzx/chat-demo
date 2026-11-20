package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/flipped-aurora/gin-vue-admin/server/global"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model"
	req "github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model/request"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const OfficialChannelID = "deepseek-official"
const OfficialOrigin = "https://api.deepseek.com"

type ChannelService struct{}
type PublicChannel struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	BaseURL  string `json:"baseUrl"`
	Model    string `json:"model"`
	HasKey   bool   `json:"hasKey"`
	Managed  bool   `json:"managed"`
	OwnerID  uint   `json:"ownerId"`
}
type ChannelState struct {
	Channels   []PublicChannel     `json:"channels"`
	ActiveID   string              `json:"activeId"`
	ModelLists map[string][]string `json:"modelLists"`
}

func publicChannel(row model.Channel) PublicChannel {
	return PublicChannel{row.ResourceID, row.Name, row.Protocol, row.BaseURL, row.Model, row.KeyCipher != "", true, row.OwnerID}
}
func sealKey(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	block, err := aes.NewCipher(config.Current.EncryptionKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return "v1:" + base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(value), nil)), nil
}
func openKey(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if !strings.HasPrefix(value, "v1:") {
		return "", errors.New("密钥存储格式无效")
	}
	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, "v1:"))
	if err != nil {
		return "", errors.New("无法读取渠道密钥")
	}
	block, err := aes.NewCipher(config.Current.EncryptionKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("无法读取渠道密钥")
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("无法解密渠道密钥")
	}
	return string(plain), nil
}
func normalizeBaseURL(value string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", ErrInvalid
	}
	u.Path = strings.TrimRight(u.Path, "/")
	for _, suffix := range []string{"/chat/completions", "/models"} {
		u.Path = strings.TrimSuffix(u.Path, suffix)
	}
	if u.Path == "" {
		u.Path = "/v1"
	}
	u.RawPath = ""
	return strings.TrimRight(u.String(), "/"), nil
}
func modelList(ids []string) []string {
	seen := map[string]bool{}
	list := []string{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" && len(id) < 1000 && !seen[id] {
			seen[id] = true
			list = append(list, id)
		}
	}
	sort.Strings(list)
	return list
}
func (s *ChannelService) ensure(ctx context.Context, owner uint) error {
	stock := model.Channel{OwnerID: owner, ResourceID: OfficialChannelID, Name: "DeepSeek", Protocol: "deepseek", BaseURL: OfficialOrigin, Model: "deepseek-flash"}
	if err := global.GVA_DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&stock).Error; err != nil {
		return err
	}
	settings := model.UserSettings{OwnerID: owner, ActiveChannelID: OfficialChannelID}
	return global.GVA_DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&settings).Error
}
func (s *ChannelService) List(ctx context.Context, owner uint) (ChannelState, error) {
	result := ChannelState{Channels: []PublicChannel{}, ModelLists: map[string][]string{}}
	if err := s.ensure(ctx, owner); err != nil {
		return result, err
	}
	var rows []model.Channel
	if err := global.GVA_DB.WithContext(ctx).Where("owner_id = ?", owner).Order("id ASC").Find(&rows).Error; err != nil {
		return result, err
	}
	for _, row := range rows {
		result.Channels = append(result.Channels, publicChannel(row))
		if len(row.ModelList) > 0 {
			var ids []string
			if json.Unmarshal(row.ModelList, &ids) == nil {
				result.ModelLists[row.ResourceID] = ids
			}
		}
	}
	var settings model.UserSettings
	if err := global.GVA_DB.WithContext(ctx).Where("owner_id = ?", owner).First(&settings).Error; err != nil {
		return result, err
	}
	result.ActiveID = settings.ActiveChannelID
	return result, nil
}
func (s *ChannelService) Get(ctx context.Context, owner uint, id string) (model.Channel, error) {
	var row model.Channel
	err := global.GVA_DB.WithContext(ctx).Where("owner_id = ? AND resource_id = ?", owner, id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrNotFound
	}
	return row, err
}
func (s *ChannelService) Save(ctx context.Context, owner uint, input req.Channel) (PublicChannel, error) {
	if !resourcePattern.MatchString(input.ID) || len(input.Name) > 160 || len(input.Model) > 500 || len(input.BaseURL) > 2000 || len(strings.TrimSpace(input.Model)) == 0 {
		return PublicChannel{}, ErrInvalid
	}
	var result model.Channel
	err := global.GVA_DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOwner(tx, owner); err != nil {
			return err
		}
		row := model.Channel{}
		err := tx.Where("owner_id = ? AND resource_id = ?", owner, input.ID).First(&row).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		previousURL, previousCipher := row.BaseURL, row.KeyCipher
		row.OwnerID = owner
		row.ResourceID = input.ID
		row.Name = strings.TrimSpace(input.Name)
		row.Model = strings.TrimSpace(input.Model)
		if input.ID == OfficialChannelID {
			row.Name = "DeepSeek"
			row.Protocol = "deepseek"
			row.BaseURL = OfficialOrigin
			row.Model = "deepseek-flash"
		} else {
			if row.Name == "" {
				return ErrInvalid
			}
			row.Protocol = "openai"
			row.BaseURL, err = normalizeBaseURL(input.BaseURL)
			if err != nil {
				return err
			}
		}
		if input.ClearKey {
			row.KeyCipher = ""
		}
		if input.APIKey != nil {
			key := strings.TrimSpace(*input.APIKey)
			if len(key) > 4096 || strings.ContainsAny(key, "\r\n") {
				return ErrInvalid
			}
			if key != "" {
				row.KeyCipher, err = sealKey(key)
				if err != nil {
					return err
				}
			}
		}
		if row.Protocol == "deepseek" && row.KeyCipher == "" {
			return errors.New("请填写 DeepSeek API Key")
		}
		if input.Models != nil {
			data, _ := json.Marshal(modelList(*input.Models))
			row.ModelList = datatypes.JSON(data)
		} else if row.BaseURL != previousURL || row.KeyCipher != previousCipher {
			row.ModelList = nil
		}
		if err = tx.Save(&row).Error; err != nil {
			return err
		}
		settings := model.UserSettings{OwnerID: owner, ActiveChannelID: row.ResourceID}
		if err = tx.Where("owner_id = ?", owner).Assign(map[string]interface{}{"active_channel_id": row.ResourceID}).FirstOrCreate(&settings).Error; err != nil {
			return err
		}
		result = row
		return nil
	})
	return publicChannel(result), err
}
func (s *ChannelService) Activate(ctx context.Context, owner uint, id string) error {
	if _, err := s.Get(ctx, owner, id); err != nil {
		return err
	}
	return global.GVA_DB.WithContext(ctx).Model(&model.UserSettings{}).Where("owner_id = ?", owner).Update("active_channel_id", id).Error
}
func (s *ChannelService) Delete(ctx context.Context, owner uint, id string) error {
	if id == OfficialChannelID {
		return ErrForbidden
	}
	return global.GVA_DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOwner(tx, owner); err != nil {
			return err
		}
		if err := tx.Unscoped().Where("owner_id = ? AND resource_id = ?", owner, id).Delete(&model.Channel{}).Error; err != nil {
			return err
		}
		return tx.Model(&model.UserSettings{}).Where("owner_id = ? AND active_channel_id = ?", owner, id).Update("active_channel_id", OfficialChannelID).Error
	})
}
func (s *ChannelService) CacheModels(ctx context.Context, owner uint, id string, ids []string) error {
	data, _ := json.Marshal(modelList(ids))
	return global.GVA_DB.WithContext(ctx).Model(&model.Channel{}).Where("owner_id = ? AND resource_id = ?", owner, id).Update("model_list", datatypes.JSON(data)).Error
}
func (s *ChannelService) PreviewModels(ctx context.Context, owner uint, input req.Channel) ([]string, error) {
	row, _ := s.Get(ctx, owner, input.ID)
	base := input.BaseURL
	var err error
	if input.Protocol == "deepseek" || input.ID == OfficialChannelID {
		base = OfficialOrigin
	} else {
		base, err = normalizeBaseURL(base)
		if err != nil {
			return nil, err
		}
	}
	key, err := openKey(row.KeyCipher)
	if err != nil {
		return nil, err
	}
	if input.ClearKey {
		key = ""
	}
	if input.APIKey != nil && strings.TrimSpace(*input.APIKey) != "" {
		key = strings.TrimSpace(*input.APIKey)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/models", nil)
	if err != nil {
		return nil, ErrInvalid
	}
	if key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := ServiceGroupApp.Proxy.Client.Do(request)
	if err != nil {
		return nil, errors.New("无法连接渠道，请检查地址与网络")
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return nil, proxyError(response, key)
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&result) != nil || result.Data == nil {
		return nil, errors.New("响应不是标准模型列表")
	}
	ids := []string{}
	for _, item := range result.Data {
		ids = append(ids, redact(item.ID, key))
	}
	ids = modelList(ids)
	storedKey, _ := openKey(row.KeyCipher)
	if row.ID != 0 && row.BaseURL == base && storedKey == key {
		_ = s.CacheModels(ctx, owner, input.ID, ids)
	}
	return ids, nil
}
