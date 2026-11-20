package router

import (
	"errors"
	"github.com/flipped-aurora/gin-vue-admin/server/model/common/response"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/api"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/service"
	"github.com/gin-gonic/gin"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Router struct{}

func secureTransport(c *gin.Context) {
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		c.Next()
		return
	}
	host, _, _ := net.SplitHostPort(c.Request.RemoteAddr)
	ip := net.ParseIP(host)
	if c.GetHeader("X-Forwarded-Proto") == "" && ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		c.Next()
		return
	}
	response.FailWithStatus(http.StatusUpgradeRequired, "账号与云端数据接口需要 HTTPS", c)
	c.Abort()
}
func originCheck(c *gin.Context) {
	if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		c.Next()
		return
	}
	origin := c.GetHeader("Origin")
	if origin != "" && origin != config.Current.PublicOrigin && origin != "http://127.0.0.1:8091" && origin != "http://localhost:8091" {
		response.FailWithStatus(403, "请求来源不允许", c)
		c.Abort()
		return
	}
	c.Next()
}
func authenticate(c *gin.Context) {
	token, _ := c.Cookie(service.SessionCookie)
	member, err := service.ServiceGroupApp.Auth.Current(c.Request.Context(), token)
	if err != nil {
		if errors.Is(err, service.ErrUnauthenticated) {
			c.Header("X-Chat-Authentication", "required")
			response.NoAuth("请先登录", c)
		} else {
			response.FailWithStatus(503, "账号服务暂不可用", c)
		}
		c.Abort()
		return
	}
	if expected := c.GetHeader("X-Chat-Owner"); expected != "" && expected != strings.TrimSpace(fmtUint(member.ID)) {
		c.Header("X-Chat-Authentication", "changed")
		response.FailWithStatus(409, "登录账号已变化，请刷新页面", c)
		c.Abort()
		return
	}
	c.Set("chat-member", member)
	c.Next()
}

type window struct {
	Start time.Time
	Count int
}

var limits = struct {
	sync.Mutex
	Values map[string]window
}{Values: map[string]window{}}

func loginLimit(c *gin.Context) {
	key := c.GetHeader("X-Real-IP")
	if key == "" {
		key = c.RemoteIP()
	}
	limits.Lock()
	now := time.Now()
	entry := limits.Values[key]
	if now.Sub(entry.Start) > time.Minute {
		entry = window{Start: now}
	}
	entry.Count++
	limits.Values[key] = entry
	if len(limits.Values) > 10000 {
		for k, v := range limits.Values {
			if now.Sub(v.Start) > time.Minute {
				delete(limits.Values, k)
			}
		}
	}
	limits.Unlock()
	if entry.Count > 20 {
		response.FailWithStatus(429, "请求频繁，请稍后再试", c)
		c.Abort()
		return
	}
	c.Next()
}
func (r *Router) Init(engine *gin.Engine, prefix string) {
	apiGroup := api.ApiGroupApp
	engine.GET(prefix+"/chat/status", apiGroup.Auth.Status)
	public := engine.Group(prefix+"/chat/auth").Use(secureTransport, originCheck, loginLimit)
	public.POST("/login", apiGroup.Auth.Login)
	public.POST("/register", apiGroup.Auth.Register)
	private := engine.Group(prefix+"/chat").Use(secureTransport, originCheck, authenticate, func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<20)
		c.Next()
	})
	private.GET("/auth/me", apiGroup.Auth.Me)
	private.POST("/auth/logout", apiGroup.Auth.Logout)
	private.POST("/auth/password", apiGroup.Auth.ChangePassword)
	private.GET("/sessions", apiGroup.Storage.List)
	private.GET("/sessions/:id", apiGroup.Storage.Get)
	private.PUT("/sessions/:id", apiGroup.Storage.Save)
	private.PATCH("/sessions/:id/title", apiGroup.Storage.Rename)
	private.DELETE("/sessions/:id", apiGroup.Storage.Delete)
	private.GET("/files/:id", apiGroup.Storage.File)
	private.POST("/files", apiGroup.Storage.SaveFiles)
	private.POST("/history/import", apiGroup.Storage.Import)
	private.GET("/channels", apiGroup.Channels.List)
	private.PUT("/channels/:id", apiGroup.Channels.Save)
	private.POST("/channels/active", apiGroup.Channels.Activate)
	private.DELETE("/channels/:id", apiGroup.Channels.Delete)
	private.POST("/channels/models", apiGroup.Channels.Models)
	private.PUT("/channels/:id/models", apiGroup.Channels.CacheModels)
	private.Any("/proxy/:id", apiGroup.Channels.Proxy)
}
