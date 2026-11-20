package chat

import (
	"fmt"
	"github.com/flipped-aurora/gin-vue-admin/server/global"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/router"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/service"
	interfaces "github.com/flipped-aurora/gin-vue-admin/server/utils/plugin/v2"
	"github.com/gin-gonic/gin"
	"os"
)

var Plugin = new(plugin)

type plugin struct{}

func init() { interfaces.Register(Plugin) }
func (p *plugin) Register(engine *gin.Engine) {
	new(router.Router).Init(engine, global.GVA_CONFIG.System.RouterPrefix)
}
func Bootstrap() error {
	if err := config.Load(); err != nil {
		return err
	}
	if global.GVA_DB == nil {
		return fmt.Errorf("chat backend requires its dedicated PostgreSQL database")
	}
	if err := service.SeedAccounts(os.Getenv("CHAT_BOOTSTRAP_ADMIN_PASSWORD"), os.Getenv("CHAT_BOOTSTRAP_USER_PASSWORD")); err != nil {
		return err
	}
	if err := global.GVA_DB.AutoMigrate(&model.Session{}, &model.File{}, &model.Channel{}, &model.UserSettings{}, &model.RevokedToken{}); err != nil {
		return err
	}
	service.InitProxyClient()
	return nil
}
