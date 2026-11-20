package service

var ServiceGroupApp = new(ServiceGroup)

type ServiceGroup struct {
	Auth     AuthService
	Storage  StorageService
	Channels ChannelService
	Proxy    ProxyService
}
