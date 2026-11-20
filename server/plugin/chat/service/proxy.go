package service

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
)

type ProxyService struct{ Client *http.Client }
type GatewayError struct {
	Status  int
	Message string
}

func (e *GatewayError) Error() string { return e.Message }

func InitProxyClient() {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{Proxy: nil, MaxIdleConns: 50, MaxIdleConnsPerHost: 10, IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: 120 * time.Second, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !config.Current.AllowPrivateChannels && !publicIP(ip.IP) {
				return nil, errors.New("渠道地址不能指向服务器内网")
			}
		}
		var last error
		for _, ip := range ips {
			connection, e := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if e == nil {
				return connection, nil
			}
			last = e
		}
		if last == nil {
			last = errors.New("无法解析渠道地址")
		}
		return nil, last
	}
	ServiceGroupApp.Proxy.Client = &http.Client{Transport: transport, Timeout: 15 * time.Minute, CheckRedirect: func(request *http.Request, previous []*http.Request) error {
		if len(previous) > 5 {
			return errors.New("渠道重定向过多")
		}
		if request.URL.Host != previous[0].URL.Host || (previous[0].URL.Scheme == "https" && request.URL.Scheme != "https") {
			return errors.New("渠道不能重定向至其他服务")
		}
		return nil
	}}
}
func publicIP(ip net.IP) bool {
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return false
		}
		if v4[0] == 0 || v4[0] >= 224 {
			return false
		}
	}
	return true
}
func redact(value string, key string) string {
	if key == "" {
		return value
	}
	value = strings.ReplaceAll(value, key, "[redacted]")
	encoded, _ := json.Marshal(key)
	if len(encoded) > 2 {
		value = strings.ReplaceAll(value, string(encoded[1:len(encoded)-1]), "[redacted]")
	}
	return value
}
func proxyError(response *http.Response, key string) error {
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	message := redact(string(raw), key)
	var value struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if json.Unmarshal([]byte(message), &value) == nil {
		var nested struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(value.Error, &nested) == nil && nested.Message != "" {
			message = nested.Message
		} else if value.Message != "" {
			message = value.Message
		}
	}
	if message == "" {
		message = http.StatusText(response.StatusCode)
	}
	return &GatewayError{Status: response.StatusCode, Message: message}
}

type redactedBody struct {
	io.ReadCloser
	original io.Closer
}

func (r *redactedBody) Close() error { _ = r.ReadCloser.Close(); return r.original.Close() }
func redactedStream(body io.ReadCloser, key string) io.ReadCloser {
	if key == "" {
		return body
	}
	reader, writer := io.Pipe()
	go func() {
		defer body.Close()
		scanner := bufio.NewScanner(body)
		scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
			if i := bytes.IndexByte(data, '\n'); i >= 0 {
				return i + 1, data[:i+1], nil
			}
			if atEOF && len(data) > 0 {
				return len(data), data, nil
			}
			return 0, nil, nil
		})
		scanner.Buffer(make([]byte, 8192), 8<<20)
		for scanner.Scan() {
			if _, err := io.WriteString(writer, redact(string(scanner.Bytes()), key)); err != nil {
				_ = writer.CloseWithError(err)
				return
			}
		}
		_ = writer.CloseWithError(scanner.Err())
	}()
	return &redactedBody{ReadCloser: reader, original: body}
}
func permittedPath(protocol, path, method string) bool {
	if strings.Contains(path, "..") || strings.ContainsAny(path, "\x00\r\n\\") {
		return false
	}
	if protocol == "openai" {
		return (method == http.MethodGet && path == "/models") || (method == http.MethodPost && path == "/chat/completions")
	}
	if path == "/models" {
		return method == http.MethodGet
	}
	if path == "/anthropic/v1/messages" || path == "/anthropic/v1/files" {
		return method == http.MethodPost || method == http.MethodGet
	}
	if strings.HasPrefix(path, "/anthropic/v1/files/") {
		return method == http.MethodGet || method == http.MethodDelete
	}
	return method == http.MethodPost && (path == "/v1/tools/asr" || path == "/v1/tools/tts")
}
func providerPath(value string) (*url.URL, error) {
	if strings.HasPrefix(value, "//") || strings.Contains(value, "://") {
		return nil, ErrForbidden
	}
	return url.ParseRequestURI("/" + strings.TrimPrefix(value, "/"))
}
func (s *ProxyService) Forward(ctx context.Context, owner uint, id, method, path string, headers http.Header, body io.Reader) (*http.Response, error) {
	channel, err := ServiceGroupApp.Channels.Get(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	key, err := openKey(channel.KeyCipher)
	if err != nil {
		return nil, err
	}
	relative, err := providerPath(path)
	if err != nil || relative.IsAbs() || !permittedPath(channel.Protocol, relative.Path, method) {
		return nil, ErrForbidden
	}
	if channel.Protocol == "deepseek" && key == "" {
		return nil, errors.New("请先配置 DeepSeek API Key")
	}
	target := strings.TrimRight(channel.BaseURL, "/") + relative.RequestURI()
	request, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, ErrInvalid
	}
	for _, name := range []string{"Content-Type", "Accept", "anthropic-beta", "anthropic-version"} {
		if value := headers.Get(name); value != "" {
			request.Header.Set(name, value)
		}
	}
	request.Header.Set("User-Agent", "chat-demo-backend")
	if key != "" {
		if channel.Protocol == "deepseek" && strings.HasPrefix(relative.Path, "/anthropic/") {
			request.Header.Set("x-api-key", key)
		} else {
			request.Header.Set("Authorization", "Bearer "+key)
		}
	}
	response, err := s.Client.Do(request)
	if err != nil {
		return nil, &GatewayError{Status: 502, Message: "无法连接模型服务，请检查渠道地址与网络"}
	}
	if response.StatusCode >= 400 {
		err = proxyError(response, key)
		response.Body.Close()
		return nil, err
	}
	contentType := response.Header.Get("Content-Type")
	for _, name := range []string{"Content-Type", "Content-Disposition", "x-request-id"} {
		response.Header.Set(name, redact(response.Header.Get(name), key))
	}
	if strings.Contains(contentType, "json") || strings.Contains(contentType, "text/") {
		response.Body = redactedStream(response.Body, key)
		response.Header.Del("Content-Length")
	}
	return response, nil
}

func FormatGatewayError(err error) string {
	var gateway *GatewayError
	if errors.As(err, &gateway) {
		return gateway.Message
	}
	return fmt.Sprint(err)
}
