package model

import (
	"github.com/flipped-aurora/gin-vue-admin/server/global"
	"gorm.io/datatypes"
	"time"
)

type Session struct {
	global.GVA_MODEL
	OwnerID       uint           `json:"-" gorm:"not null;uniqueIndex:idx_chat_session_owner_resource;index"`
	ResourceID    string         `json:"resourceId" gorm:"size:128;not null;uniqueIndex:idx_chat_session_owner_resource"`
	Title         string         `json:"title" gorm:"size:500"`
	CreatedMillis int64          `json:"createdAt"`
	UpdatedMillis int64          `json:"updatedAt" gorm:"index"`
	Revision      uint64         `json:"revision" gorm:"not null;default:1"`
	Payload       datatypes.JSON `json:"-" gorm:"type:jsonb;not null"`
	FileIDs       datatypes.JSON `json:"-" gorm:"type:jsonb;not null"`
}

func (Session) TableName() string { return "chat_sessions" }

type File struct {
	global.GVA_MODEL
	OwnerID    uint   `json:"-" gorm:"not null;uniqueIndex:idx_chat_file_owner_resource;index"`
	ResourceID string `json:"id" gorm:"size:128;not null;uniqueIndex:idx_chat_file_owner_resource"`
	Name       string `json:"name" gorm:"size:500"`
	MimeType   string `json:"mimeType" gorm:"size:150"`
	Size       int64  `json:"size"`
	Blob       []byte `json:"-" gorm:"type:bytea;not null"`
}

func (File) TableName() string { return "chat_files" }

type Channel struct {
	global.GVA_MODEL
	OwnerID    uint           `json:"-" gorm:"not null;uniqueIndex:idx_chat_channel_owner_resource;index"`
	ResourceID string         `json:"id" gorm:"size:128;not null;uniqueIndex:idx_chat_channel_owner_resource"`
	Name       string         `json:"name" gorm:"size:160"`
	Protocol   string         `json:"protocol" gorm:"size:20"`
	BaseURL    string         `json:"baseUrl" gorm:"size:2000"`
	Model      string         `json:"model" gorm:"size:500"`
	KeyCipher  string         `json:"-" gorm:"type:text"`
	ModelList  datatypes.JSON `json:"-" gorm:"type:jsonb"`
}

func (Channel) TableName() string { return "chat_channels" }

type UserSettings struct {
	global.GVA_MODEL
	OwnerID         uint   `json:"-" gorm:"not null;uniqueIndex"`
	ActiveChannelID string `json:"activeId" gorm:"size:128"`
}

func (UserSettings) TableName() string { return "chat_user_settings" }

type RevokedToken struct {
	global.GVA_MODEL
	Digest    string    `json:"-" gorm:"size:64;not null;uniqueIndex"`
	ExpiresAt time.Time `json:"-" gorm:"index"`
}

func (RevokedToken) TableName() string { return "chat_revoked_tokens" }
