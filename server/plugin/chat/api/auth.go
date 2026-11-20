package api

import (
	"github.com/flipped-aurora/gin-vue-admin/server/model/common/response"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
	req "github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model/request"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/service"
	"github.com/gin-gonic/gin"
	"net/http"
	"time"
)

type AuthApi struct{}

func cookie(c *gin.Context, token string, expires time.Time) {
	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	age := int(time.Until(expires).Seconds())
	if token == "" {
		age = -1
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(service.SessionCookie, token, age, "/api/chat", "", secure, true)
}

// Status describes deployment and registration; it contains no user data.
// @Tags ChatAuth
// @Summary 获取聊天后端状态
// @Produce json
// @Success 200 {object} response.Response
// @Router /chat/status [get]
func (a *AuthApi) Status(c *gin.Context) {
	response.OkWithData(gin.H{"enabled": true, "publicOrigin": config.Current.PublicOrigin, "registration": "invite", "storage": "postgresql"}, c)
}

// Login authenticates a GVA account and sets an HttpOnly session cookie.
// @Tags ChatAuth
// @Summary 登录聊天账号
// @Accept json
// @Produce json
// @Param credentials body req.Login true "账号和密码"
// @Success 200 {object} response.Response
// @Failure 401 {object} response.Response
// @Router /chat/auth/login [post]
func (a *AuthApi) Login(c *gin.Context) {
	var input req.Login
	if c.ShouldBindJSON(&input) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	member, token, expiry, err := service.ServiceGroupApp.Auth.Login(c.Request.Context(), input)
	if err != nil {
		response.FailWithStatus(401, "用户名或密码不正确", c)
		return
	}
	cookie(c, token, expiry)
	response.OkWithData(member, c)
}

// Register creates only a normal chat account using the configured invitation.
// @Tags ChatAuth
// @Summary 使用邀请码注册聊天账号
// @Accept json
// @Produce json
// @Param credentials body req.Register true "注册信息"
// @Success 200 {object} response.Response
// @Failure 400 {object} response.Response
// @Router /chat/auth/register [post]
func (a *AuthApi) Register(c *gin.Context) {
	var input req.Register
	if c.ShouldBindJSON(&input) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	member, token, expiry, err := service.ServiceGroupApp.Auth.Register(c.Request.Context(), input)
	if err != nil {
		Fail(c, err)
		return
	}
	cookie(c, token, expiry)
	response.OkWithData(member, c)
}

// Me returns the authenticated account without tokens or password fields.
// @Tags ChatAuth
// @Summary 获取当前聊天账号
// @Produce json
// @Success 200 {object} response.Response
// @Failure 401 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/auth/me [get]
func (a *AuthApi) Me(c *gin.Context) { response.OkWithData(Who(c), c) }

// Logout revokes the current token in PostgreSQL.
// @Tags ChatAuth
// @Summary 退出当前账号
// @Produce json
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/auth/logout [post]
func (a *AuthApi) Logout(c *gin.Context) {
	token, _ := c.Cookie(service.SessionCookie)
	if err := service.ServiceGroupApp.Auth.Logout(c.Request.Context(), token); err != nil {
		Fail(c, err)
		return
	}
	cookie(c, "", time.Now())
	response.Ok(c)
}

// ChangePassword uses GVA's bcrypt password service and rotates the current cookie.
// @Tags ChatAuth
// @Summary 修改聊天账号密码
// @Accept json
// @Produce json
// @Param password body req.ChangePassword true "原密码和新密码"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/auth/password [post]
func (a *AuthApi) ChangePassword(c *gin.Context) {
	var input req.ChangePassword
	if c.ShouldBindJSON(&input) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	token, expiry, err := service.ServiceGroupApp.Auth.ChangePassword(c.Request.Context(), Who(c), input)
	if err != nil {
		Fail(c, err)
		return
	}
	cookie(c, token, expiry)
	response.Ok(c)
}
