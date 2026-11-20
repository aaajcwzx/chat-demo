package api

import (
	"encoding/json"
	"github.com/flipped-aurora/gin-vue-admin/server/model/common/response"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
	req "github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model/request"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/service"
	"github.com/gin-gonic/gin"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
)

type StorageApi struct{}

func uploads(c *gin.Context) ([]req.UploadFile, error) {
	if err := c.Request.ParseMultipartForm(4 << 20); err != nil {
		return nil, service.ErrInvalid
	}
	var metadata []struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		MimeType string `json:"mimeType"`
	}
	if raw := c.PostForm("fileMetadata"); raw != "" && json.Unmarshal([]byte(raw), &metadata) != nil {
		return nil, service.ErrInvalid
	}
	byID := map[string]req.UploadFile{}
	for _, item := range metadata {
		byID[item.ID] = req.UploadFile{ID: item.ID, Name: item.Name, MimeType: item.MimeType}
	}
	files := []req.UploadFile{}
	for name, parts := range c.Request.MultipartForm.File {
		id := strings.TrimPrefix(name, "file:")
		meta, ok := byID[id]
		if !ok || len(parts) != 1 || parts[0].Size > config.Current.MaxFileBytes {
			return nil, service.ErrInvalid
		}
		reader, err := parts[0].Open()
		if err != nil {
			return nil, err
		}
		blob, err := io.ReadAll(io.LimitReader(reader, config.Current.MaxFileBytes+1))
		reader.Close()
		if err != nil {
			return nil, err
		}
		meta.Blob = blob
		files = append(files, meta)
	}
	return files, nil
}
func cleanMultipart(c *gin.Context) {
	if c.Request.MultipartForm != nil {
		_ = c.Request.MultipartForm.RemoveAll()
	}
}

// List returns this account's session summaries and revisions.
// @Tags ChatStorage
// @Summary 获取自己的会话列表
// @Produce json
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/sessions [get]
func (a *StorageApi) List(c *gin.Context) {
	rows, err := service.ServiceGroupApp.Storage.List(c.Request.Context(), Who(c).ID)
	if err != nil {
		Fail(c, err)
		return
	}
	response.OkWithData(gin.H{"page": 1, "pageSize": 5000, "total": len(rows), "list": rows}, c)
}

// Get returns one owned session; IDs from other accounts are not discoverable.
// @Tags ChatStorage
// @Summary 获取自己的会话内容
// @Param id path string true "会话ID"
// @Produce json
// @Success 200 {object} response.Response
// @Failure 404 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/sessions/{id} [get]
func (a *StorageApi) Get(c *gin.Context) {
	result, err := service.ServiceGroupApp.Storage.Get(c.Request.Context(), Who(c).ID, c.Param("id"))
	if err != nil {
		Fail(c, err)
		return
	}
	response.OkWithData(result, c)
}

// Save accepts JSON or multipart session plus original files and an If-Match revision.
// @Tags ChatStorage
// @Summary 保存自己的会话与附件
// @Accept json,mpfd
// @Param id path string true "会话ID"
// @Param If-Match header string true "会话版本，新会话使用0"
// @Produce json
// @Success 200 {object} response.Response
// @Failure 409 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/sessions/{id} [put]
func (a *StorageApi) Save(c *gin.Context) {
	version, err := strconv.ParseUint(strings.Trim(c.GetHeader("If-Match"), "\""), 10, 64)
	if err != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	var raw []byte
	files := []req.UploadFile{}
	if strings.HasPrefix(c.ContentType(), "multipart/") {
		files, err = uploads(c)
		defer cleanMultipart(c)
		raw = []byte(c.PostForm("session"))
	} else {
		raw, err = io.ReadAll(io.LimitReader(c.Request.Body, config.Current.MaxSessionBytes+1))
	}
	if err != nil {
		Fail(c, err)
		return
	}
	result, err := service.ServiceGroupApp.Storage.Save(c.Request.Context(), Who(c).ID, c.Param("id"), raw, files, &version)
	if err != nil {
		Fail(c, err)
		return
	}
	response.OkWithData(result, c)
}

// Rename changes the owned session's title and revision.
// @Tags ChatStorage
// @Summary 修改会话标题
// @Accept json
// @Param id path string true "会话ID"
// @Param title body object true "新标题"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/sessions/{id}/title [patch]
func (a *StorageApi) Rename(c *gin.Context) {
	var input struct {
		Title string `json:"title"`
	}
	if c.ShouldBindJSON(&input) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	if err := service.ServiceGroupApp.Storage.Rename(c.Request.Context(), Who(c).ID, c.Param("id"), input.Title); err != nil {
		Fail(c, err)
		return
	}
	response.Ok(c)
}

// Delete removes only this account's session and unreferenced original files.
// @Tags ChatStorage
// @Summary 删除自己的会话
// @Param id path string true "会话ID"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/sessions/{id} [delete]
func (a *StorageApi) Delete(c *gin.Context) {
	if err := service.ServiceGroupApp.Storage.Delete(c.Request.Context(), Who(c).ID, c.Param("id")); err != nil {
		Fail(c, err)
		return
	}
	response.Ok(c)
}

// File returns an authenticated download using a safe non-inline MIME type.
// @Tags ChatStorage
// @Summary 下载自己的附件原件
// @Param id path string true "附件ID"
// @Success 200 {file} binary
// @Failure 404 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/files/{id} [get]
func (a *StorageApi) File(c *gin.Context) {
	file, err := service.ServiceGroupApp.Storage.ReadFile(c.Request.Context(), Who(c).ID, c.Param("id"))
	if err != nil {
		Fail(c, err)
		return
	}
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": file.Name}))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Data(http.StatusOK, "application/octet-stream", file.Blob)
}

// SaveFiles uploads owned file originals independently of a session save.
// @Tags ChatStorage
// @Summary 上传附件原件
// @Accept mpfd
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/files [post]
func (a *StorageApi) SaveFiles(c *gin.Context) {
	files, err := uploads(c)
	defer cleanMultipart(c)
	if err != nil {
		Fail(c, err)
		return
	}
	if err = service.ServiceGroupApp.Storage.SaveFiles(c.Request.Context(), Who(c).ID, files); err != nil {
		Fail(c, err)
		return
	}
	response.Ok(c)
}

// Import merges local records by default; replace=true performs a transactional history replacement.
// @Tags ChatStorage
// @Summary 迁移或导入当前账号的聊天记录
// @Accept mpfd
// @Param sessions formData string true "会话JSON数组"
// @Param replace formData bool false "是否覆盖当前账号全部历史"
// @Success 200 {object} response.Response
// @Security ChatSessionAuth
// @Description 使用 HttpOnly chat-session Cookie 登录；X-Chat-Owner 为当前账号ID。
// @Router /chat/history/import [post]
func (a *StorageApi) Import(c *gin.Context) {
	files, err := uploads(c)
	defer cleanMultipart(c)
	if err != nil {
		Fail(c, err)
		return
	}
	var sessions []json.RawMessage
	if json.Unmarshal([]byte(c.PostForm("sessions")), &sessions) != nil {
		Fail(c, service.ErrInvalid)
		return
	}
	count, err := service.ServiceGroupApp.Storage.Import(c.Request.Context(), Who(c).ID, sessions, files, c.PostForm("replace") == "true")
	if err != nil {
		Fail(c, err)
		return
	}
	response.OkWithData(gin.H{"imported": count}, c)
}
