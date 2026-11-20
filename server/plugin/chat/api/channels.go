package api

import (
	"github.com/flipped-aurora/gin-vue-admin/server/model/common/response"
	req "github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model/request"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/service"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
)

type ChannelApi struct{}

// List returns channel metadata, key-presence flags and model caches without secrets.
// @Tags ChatChannels
// @Summary 获取自己的模型渠道
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/channels [get]
func (a *ChannelApi) List(c *gin.Context) {
	state, err := service.ServiceGroupApp.Channels.List(c.Request.Context(), Who(c).ID)
	if err != nil {
		Fail(c, err)
		return
	}
	response.OkWithData(state, c)
}

// Save replaces a key only when a new value or explicit clear flag is supplied.
// @Tags ChatChannels
// @Summary 保存自己的渠道配置
// @Accept json
// @Param channel body req.Channel true "渠道配置，未提供apiKey则保留旧密钥"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/channels/{id} [put]
func (a *ChannelApi) Save(c *gin.Context) {
	var input req.Channel
	if c.ShouldBindJSON(&input) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	input.ID = c.Param("id")
	row, err := service.ServiceGroupApp.Channels.Save(c.Request.Context(), Who(c).ID, input)
	if err != nil {
		Fail(c, err)
		return
	}
	response.OkWithData(row, c)
}

// Activate selects an existing owned channel.
// @Tags ChatChannels
// @Summary 切换当前渠道
// @Accept json
// @Param selection body object true "渠道ID"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/channels/active [post]
func (a *ChannelApi) Activate(c *gin.Context) {
	var input struct {
		ID string `json:"id"`
	}
	if c.ShouldBindJSON(&input) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	if err := service.ServiceGroupApp.Channels.Activate(c.Request.Context(), Who(c).ID, input.ID); err != nil {
		Fail(c, err)
		return
	}
	response.Ok(c)
}

// Delete removes an owned custom channel and returns to the official channel if active.
// @Tags ChatChannels
// @Summary 删除自己的自定义渠道
// @Param id path string true "渠道ID"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/channels/{id} [delete]
func (a *ChannelApi) Delete(c *gin.Context) {
	if err := service.ServiceGroupApp.Channels.Delete(c.Request.Context(), Who(c).ID, c.Param("id")); err != nil {
		Fail(c, err)
		return
	}
	response.Ok(c)
}

// Models tests saved or draft credentials without returning their values.
// @Tags ChatChannels
// @Summary 获取渠道模型列表
// @Accept json
// @Param channel body req.Channel true "待测试渠道"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/channels/models [post]
func (a *ChannelApi) Models(c *gin.Context) {
	var input req.Channel
	if c.ShouldBindJSON(&input) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	ids, err := service.ServiceGroupApp.Channels.PreviewModels(c.Request.Context(), Who(c).ID, input)
	if err != nil {
		Fail(c, err)
		return
	}
	response.OkWithData(ids, c)
}

// CacheModels stores the selected channel's already-fetched model list.
// @Tags ChatChannels
// @Summary 更新缓存的模型列表
// @Accept json
// @Param id path string true "渠道ID"
// @Param models body object true "模型ID列表"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/channels/{id}/models [put]
func (a *ChannelApi) CacheModels(c *gin.Context) {
	var input struct {
		Models []string `json:"models"`
	}
	if c.ShouldBindJSON(&input) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	if err := service.ServiceGroupApp.Channels.CacheModels(c.Request.Context(), Who(c).ID, c.Param("id"), input.Models); err != nil {
		Fail(c, err)
		return
	}
	response.Ok(c)
}

type flushWriter struct{ http.ResponseWriter }

func (w flushWriter) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
	return n, err
}

// Proxy forwards only allowed provider endpoints with the owner's encrypted key.
// @Tags ChatChannels
// @Summary 转发模型、附件或语音请求
// @Param id path string true "渠道ID"
// @Param path query string true "服务接口的相对路径"
// @Success 200 {string} string "模型原始流或二进制内容"
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/proxy/{id} [post]
// @Router /chat/proxy/{id} [get]
// @Router /chat/proxy/{id} [delete]
func (a *ChannelApi) Proxy(c *gin.Context) {
	upstream, err := service.ServiceGroupApp.Proxy.Forward(c.Request.Context(), Who(c).ID, c.Param("id"), c.Request.Method, c.Query("path"), c.Request.Header, c.Request.Body)
	if err != nil {
		Fail(c, err)
		return
	}
	defer upstream.Body.Close()
	for _, name := range []string{"Content-Type", "Content-Disposition", "x-request-id"} {
		if value := upstream.Header.Get(name); value != "" {
			c.Header(name, value)
		}
	}
	c.Header("Cache-Control", "no-cache, no-store")
	c.Header("X-Accel-Buffering", "no")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(upstream.StatusCode)
	_, _ = io.Copy(flushWriter{c.Writer}, upstream.Body)
}
