package api

import (
	"errors"
	"github.com/flipped-aurora/gin-vue-admin/server/model/common/response"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/service"
	"github.com/gin-gonic/gin"
	"net/http"
)

var ApiGroupApp = new(ApiGroup)

type ApiGroup struct {
	Auth     AuthApi
	Storage  StorageApi
	Channels ChannelApi
}

func Who(c *gin.Context) service.Member {
	value, _ := c.Get("chat-member")
	member, _ := value.(service.Member)
	return member
}
func Fail(c *gin.Context, err error) {
	status := http.StatusBadRequest
	var gateway *service.GatewayError
	switch {
	case errors.As(err, &gateway):
		status = gateway.Status
	case errors.Is(err, service.ErrUnauthenticated):
		status = http.StatusUnauthorized
		c.Header("X-Chat-Authentication", "required")
	case errors.Is(err, service.ErrForbidden):
		status = http.StatusForbidden
	case errors.Is(err, service.ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, service.ErrConflict):
		status = http.StatusConflict
	case errors.Is(err, service.ErrQuota):
		status = http.StatusRequestEntityTooLarge
	}
	response.FailWithStatus(status, err.Error(), c)
}
