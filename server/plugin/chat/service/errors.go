package service

import "errors"

var (
	ErrUnauthenticated = errors.New("请先登录")
	ErrForbidden       = errors.New("没有访问权限")
	ErrInvalid         = errors.New("请求参数不正确")
	ErrNotFound        = errors.New("记录不存在")
	ErrConflict        = errors.New("会话已在其他设备更新，请导出当前内容后重新打开会话")
	ErrQuota           = errors.New("已超过文件存储额度")
)
