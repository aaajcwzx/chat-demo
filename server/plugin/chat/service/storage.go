package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"github.com/flipped-aurora/gin-vue-admin/server/global"
	coreModel "github.com/flipped-aurora/gin-vue-admin/server/model/system"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/config"
	"github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model"
	req "github.com/flipped-aurora/gin-vue-admin/server/plugin/chat/model/request"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type StorageService struct{}
type Summary struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	Revision  uint64 `json:"revision"`
}
type StoredSession struct {
	Session  json.RawMessage `json:"session"`
	Revision uint64          `json:"revision"`
}

var resourcePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)

func lockOwner(tx *gorm.DB, owner uint) error {
	var user coreModel.SysUser
	if err := tx.Select("id").Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, owner).Error; err != nil {
		return ErrUnauthenticated
	}
	return nil
}
func validateSession(raw []byte) (req.Session, []string, error) {
	var value req.Session
	if int64(len(raw)) > config.Current.MaxSessionBytes || json.Unmarshal(raw, &value) != nil || !resourcePattern.MatchString(value.ID) || len(value.Title) > 2000 || len(value.Messages) > 20000 {
		return value, nil, ErrInvalid
	}
	ids := make([]string, 0)
	seen := map[string]bool{}
	for _, message := range value.Messages {
		var fields struct {
			ID    string `json:"id"`
			Role  string `json:"role"`
			Files []struct {
				ID string `json:"id"`
			} `json:"files"`
		}
		if json.Unmarshal(message, &fields) != nil || !resourcePattern.MatchString(fields.ID) || (fields.Role != "user" && fields.Role != "assistant") {
			return value, nil, ErrInvalid
		}
		for _, file := range fields.Files {
			if !resourcePattern.MatchString(file.ID) {
				return value, nil, ErrInvalid
			}
			if !seen[file.ID] {
				seen[file.ID] = true
				ids = append(ids, file.ID)
			}
		}
	}
	return value, ids, nil
}
func (s *StorageService) List(ctx context.Context, owner uint) ([]Summary, error) {
	var rows []model.Session
	err := global.GVA_DB.WithContext(ctx).Select("resource_id,title,created_millis,updated_millis,revision").Where("owner_id = ?", owner).Order("updated_millis DESC").Limit(5000).Find(&rows).Error
	list := make([]Summary, 0, len(rows))
	for _, r := range rows {
		list = append(list, Summary{r.ResourceID, r.Title, r.CreatedMillis, r.UpdatedMillis, r.Revision})
	}
	return list, err
}
func (s *StorageService) Get(ctx context.Context, owner uint, id string) (StoredSession, error) {
	var row model.Session
	err := global.GVA_DB.WithContext(ctx).Where("owner_id = ? AND resource_id = ?", owner, id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return StoredSession{}, ErrNotFound
	}
	return StoredSession{Session: json.RawMessage(row.Payload), Revision: row.Revision}, err
}
func saveFile(tx *gorm.DB, owner uint, input req.UploadFile) error {
	if !resourcePattern.MatchString(input.ID) || len(input.Name) > 2000 || len(input.MimeType) > 150 || int64(len(input.Blob)) > config.Current.MaxFileBytes {
		return ErrInvalid
	}
	var existing model.File
	err := tx.Where("owner_id = ? AND resource_id = ?", owner, input.ID).First(&existing).Error
	if err == nil {
		if sha256.Sum256(existing.Blob) != sha256.Sum256(input.Blob) {
			return errors.New("同一文件标识已存在不同内容")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var used int64
	if err = tx.Model(&model.File{}).Where("owner_id = ?", owner).Select("COALESCE(SUM(size),0)").Scan(&used).Error; err != nil {
		return err
	}
	if used+int64(len(input.Blob)) > config.Current.MaxUserFileBytes {
		return ErrQuota
	}
	return tx.Create(&model.File{OwnerID: owner, ResourceID: input.ID, Name: input.Name, MimeType: input.MimeType, Size: int64(len(input.Blob)), Blob: input.Blob}).Error
}
func saveSession(tx *gorm.DB, owner uint, raw []byte, expected *uint64) (StoredSession, error) {
	value, files, err := validateSession(raw)
	if err != nil {
		return StoredSession{}, err
	}
	var row model.Session
	err = tx.Where("owner_id = ? AND resource_id = ?", owner, value.ID).First(&row).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return StoredSession{}, err
	}
	if expected != nil && ((row.ID == 0 && *expected != 0) || (row.ID != 0 && row.Revision != *expected)) {
		return StoredSession{}, ErrConflict
	}
	if row.ID == 0 {
		var count int64
		if err = tx.Model(&model.Session{}).Where("owner_id = ?", owner).Count(&count).Error; err != nil {
			return StoredSession{}, err
		}
		if count >= 5000 {
			return StoredSession{}, errors.New("已超过会话数量上限")
		}
	}
	fileJSON, _ := json.Marshal(files)
	row.OwnerID = owner
	row.ResourceID = value.ID
	row.Title = value.Title
	row.CreatedMillis = value.CreatedAt
	row.UpdatedMillis = value.UpdatedAt
	if row.CreatedMillis <= 0 {
		row.CreatedMillis = time.Now().UnixMilli()
	}
	if row.UpdatedMillis <= 0 {
		row.UpdatedMillis = time.Now().UnixMilli()
	}
	row.Revision++
	row.Payload = datatypes.JSON(raw)
	row.FileIDs = datatypes.JSON(fileJSON)
	if err = tx.Save(&row).Error; err != nil {
		return StoredSession{}, err
	}
	return StoredSession{Session: json.RawMessage(row.Payload), Revision: row.Revision}, nil
}
func (s *StorageService) Save(ctx context.Context, owner uint, id string, raw []byte, files []req.UploadFile, expected *uint64) (StoredSession, error) {
	value, _, err := validateSession(raw)
	if err != nil || value.ID != id {
		return StoredSession{}, ErrInvalid
	}
	var result StoredSession
	err = global.GVA_DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := lockOwner(tx, owner); e != nil {
			return e
		}
		for _, file := range files {
			if e := saveFile(tx, owner, file); e != nil {
				return e
			}
		}
		var e error
		result, e = saveSession(tx, owner, raw, expected)
		return e
	})
	return result, err
}
func (s *StorageService) Rename(ctx context.Context, owner uint, id, title string) error {
	if len(title) > 2000 {
		return ErrInvalid
	}
	return global.GVA_DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOwner(tx, owner); err != nil {
			return err
		}
		var row model.Session
		if err := tx.Where("owner_id = ? AND resource_id = ?", owner, id).First(&row).Error; err != nil {
			return ErrNotFound
		}
		var data map[string]json.RawMessage
		if err := json.Unmarshal(row.Payload, &data); err != nil {
			return err
		}
		data["title"], _ = json.Marshal(title)
		data["updatedAt"], _ = json.Marshal(time.Now().UnixMilli())
		raw, _ := json.Marshal(data)
		_, err := saveSession(tx, owner, raw, nil)
		return err
	})
}
func (s *StorageService) Delete(ctx context.Context, owner uint, id string) error {
	return global.GVA_DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOwner(tx, owner); err != nil {
			return err
		}
		var row model.Session
		if err := tx.Where("owner_id = ? AND resource_id = ?", owner, id).First(&row).Error; err != nil {
			return ErrNotFound
		}
		var ids []string
		_ = json.Unmarshal(row.FileIDs, &ids)
		if err := tx.Unscoped().Delete(&row).Error; err != nil {
			return err
		}
		for _, fileID := range ids {
			var count int64
			if err := tx.Model(&model.Session{}).Where("owner_id = ? AND jsonb_exists(file_ids, ?)", owner, fileID).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				if err := tx.Unscoped().Where("owner_id = ? AND resource_id = ?", owner, fileID).Delete(&model.File{}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}
func (s *StorageService) ReadFile(ctx context.Context, owner uint, id string) (model.File, error) {
	var file model.File
	err := global.GVA_DB.WithContext(ctx).Where("owner_id = ? AND resource_id = ?", owner, id).First(&file).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrNotFound
	}
	return file, err
}
func (s *StorageService) SaveFiles(ctx context.Context, owner uint, files []req.UploadFile) error {
	return global.GVA_DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOwner(tx, owner); err != nil {
			return err
		}
		for _, file := range files {
			if err := saveFile(tx, owner, file); err != nil {
				return err
			}
		}
		return nil
	})
}
func (s *StorageService) Import(ctx context.Context, owner uint, sessions []json.RawMessage, files []req.UploadFile, replace bool) (int, error) {
	if len(sessions) > 5000 {
		return 0, ErrInvalid
	}
	for _, raw := range sessions {
		if _, _, err := validateSession(raw); err != nil {
			return 0, err
		}
	}
	count := 0
	err := global.GVA_DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOwner(tx, owner); err != nil {
			return err
		}
		if replace {
			if err := tx.Unscoped().Where("owner_id = ?", owner).Delete(&model.Session{}).Error; err != nil {
				return err
			}
			if err := tx.Unscoped().Where("owner_id = ?", owner).Delete(&model.File{}).Error; err != nil {
				return err
			}
		}
		for _, file := range files {
			if err := saveFile(tx, owner, file); err != nil {
				return err
			}
		}
		for _, raw := range sessions {
			var value req.Session
			_ = json.Unmarshal(raw, &value)
			var existing model.Session
			if !replace && tx.Where("owner_id = ? AND resource_id = ?", owner, value.ID).First(&existing).Error == nil {
				continue
			}
			if _, err := saveSession(tx, owner, raw, nil); err != nil {
				return err
			}
			count++
		}
		return nil
	})
	return count, err
}
