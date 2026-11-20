package config

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Settings struct {
	PublicOrigin         string
	InviteCode           string
	EncryptionKey        []byte
	AllowPrivateChannels bool
	MaxFileBytes         int64
	MaxUserFileBytes     int64
	MaxSessionBytes      int64
}

var Current Settings

func Load() error {
	key, err := base64.StdEncoding.DecodeString(os.Getenv("CHAT_ENCRYPTION_KEY"))
	if err != nil || len(key) != 32 {
		return fmt.Errorf("CHAT_ENCRYPTION_KEY must contain a base64-encoded 32-byte key")
	}
	origin := strings.TrimRight(os.Getenv("CHAT_PUBLIC_ORIGIN"), "/")
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("CHAT_PUBLIC_ORIGIN must be an HTTPS origin")
	}
	Current = Settings{PublicOrigin: origin, InviteCode: os.Getenv("CHAT_INVITE_CODE"), EncryptionKey: key, AllowPrivateChannels: os.Getenv("CHAT_ALLOW_PRIVATE_CHANNELS") == "true", MaxFileBytes: limit("CHAT_MAX_FILE_BYTES", 20<<20), MaxUserFileBytes: limit("CHAT_MAX_USER_FILE_BYTES", 250<<20), MaxSessionBytes: limit("CHAT_MAX_SESSION_BYTES", 8<<20)}
	return nil
}

func limit(name string, fallback int64) int64 {
	if value, err := strconv.ParseInt(os.Getenv(name), 10, 64); err == nil && value > 0 {
		return value
	}
	return fallback
}
