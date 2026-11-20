package request

import "encoding/json"

type Login struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}
type Register struct {
	Login
	Nickname   string `json:"nickname"`
	InviteCode string `json:"inviteCode"`
}
type ChangePassword struct {
	OldPassword string `json:"oldPassword" binding:"required"`
	NewPassword string `json:"newPassword" binding:"required"`
}
type Channel struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Protocol string    `json:"protocol"`
	BaseURL  string    `json:"baseUrl"`
	Model    string    `json:"model"`
	APIKey   *string   `json:"apiKey"`
	ClearKey bool      `json:"clearKey"`
	Models   *[]string `json:"models"`
}
type Session struct {
	ID        string            `json:"id"`
	Title     string            `json:"title"`
	CreatedAt int64             `json:"createdAt"`
	UpdatedAt int64             `json:"updatedAt"`
	Messages  []json.RawMessage `json:"messages"`
}
type UploadFile struct {
	ID       string
	Name     string
	MimeType string
	Blob     []byte
}
