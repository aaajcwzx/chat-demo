package service

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
)

func TestEncryptedKeyIntegrity(t *testing.T) {
	previous := config.Current
	t.Cleanup(func() { config.Current = previous })
	config.Current.EncryptionKey = bytes.Repeat([]byte{7}, 32)
	secret := "fixture-secret-密钥"
	first, err := sealKey(secret)
	if err != nil {
		t.Fatal(err)
	}
	second, err := sealKey(secret)
	if err != nil || first == second || strings.Contains(first, secret) {
		t.Fatal("encryption must use independent nonces")
	}
	plain, err := openKey(first)
	if err != nil || plain != secret {
		t.Fatal("encrypted key cannot be read")
	}
	config.Current.EncryptionKey = bytes.Repeat([]byte{8}, 32)
	if _, err = openKey(first); err == nil {
		t.Fatal("wrong encryption key must fail authentication")
	}
	if _, err = openKey("v1:bad-format"); err == nil {
		t.Fatal("invalid ciphertext must be rejected")
	}
}

func TestClientRejectsPrivateGateways(t *testing.T) {
	previous := config.Current
	t.Cleanup(func() { config.Current = previous })
	config.Current.AllowPrivateChannels = false
	server := httptest.NewServer(nil)
	defer server.Close()
	InitProxyClient()
	if response, err := ServiceGroupApp.Proxy.Client.Get(server.URL); err == nil {
		response.Body.Close()
		t.Fatal("production client reached a loopback gateway")
	}
}

func TestStreamRedactionPreservesProtocol(t *testing.T) {
	secret := "fixture-quote\"-key"
	encoded, _ := json.Marshal(secret)
	input := "event: message\r\ndata: 中文 ✓ " + secret + "\r\n\r\ndata: " + string(encoded) + "\n\ndata: [DONE]\n\n"
	reader, writer := io.Pipe()
	go func() {
		defer writer.Close()
		for _, b := range []byte(input) {
			if _, err := writer.Write([]byte{b}); err != nil {
				return
			}
		}
	}()
	filtered := redactedStream(reader, secret)
	defer filtered.Close()
	output, err := io.ReadAll(filtered)
	if err != nil {
		t.Fatal(err)
	}
	expected := "event: message\r\ndata: 中文 ✓ [redacted]\r\n\r\ndata: \"[redacted]\"\n\ndata: [DONE]\n\n"
	if string(output) != expected {
		t.Fatal("redaction changed SSE lines or UTF-8 text")
	}
}

func TestGatewayPathsAndAddresses(t *testing.T) {
	for _, value := range []string{"models", "/models", "chat/completions"} {
		u, err := providerPath(value)
		if err != nil || !strings.HasPrefix(u.Path, "/") {
			t.Fatalf("relative endpoint rejected: %s", value)
		}
	}
	for _, value := range []string{"https://example.com/models", "//example.com/models"} {
		if _, err := providerPath(value); err == nil {
			t.Fatal("absolute endpoint accepted")
		}
	}
	for _, row := range []struct {
		protocol, path, method string
		allowed                bool
	}{
		{"openai", "/models", "GET", true}, {"openai", "/chat/completions", "POST", true},
		{"openai", "/models", "DELETE", false}, {"openai", "/anthropic/v1/files", "POST", false},
		{"deepseek", "/anthropic/v1/files/fixture", "DELETE", true}, {"deepseek", "/v1/tools/tts", "POST", true},
		{"deepseek", "/anthropic/v1/files/../messages", "GET", false},
	} {
		if permittedPath(row.protocol, row.path, row.method) != row.allowed {
			t.Fatalf("incorrect endpoint policy: %#v", row)
		}
	}
	for _, address := range []string{"127.0.0.1", "10.0.0.1", "172.18.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "::1", "fc00::1", "fe80::1"} {
		if publicIP(net.ParseIP(address)) {
			t.Fatalf("private or metadata IP allowed: %s", address)
		}
	}
	if !publicIP(net.ParseIP("8.8.8.8")) {
		t.Fatal("public IP rejected")
	}
}
