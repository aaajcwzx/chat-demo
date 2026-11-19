import clsx from 'clsx'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from '../base/icons.js'
import styles from './ModelPicker.module.css'

type Props = {
  value: string
  models: readonly string[]
  onChange: (model: string) => void
  inputId?: string
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
  open?: boolean
  selectionDisabled?: boolean
  loading?: boolean
  editable?: boolean
  subtitle?: string
  resetKey?: string
  menuHeader?: ReactNode
  menuFooter?: ReactNode
  onOpenChange?: (open: boolean) => void
}

/** The selected model never filters the popup; only its separate search field does. */
export const ModelPicker = ({
  value,
  models,
  onChange,
  inputId,
  ariaLabel,
  placeholder,
  disabled = false,
  open: controlledOpen,
  selectionDisabled = false,
  loading = false,
  editable = true,
  subtitle,
  resetKey,
  menuHeader,
  menuFooter,
  onOpenChange,
}: Props) => {
  const t = useTranslate()
  const id = useId()
  const [internalOpen, setOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const allModels = useMemo(
    () => [...new Set(models.length ? models : value ? [value] : [])],
    [models, value]
  )
  const filtered = useMemo(
    () =>
      allModels.filter((model) =>
        model.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      ),
    [allModels, query]
  )
  const { anchorRef, floatingRef, position } = useAnchoredPosition<HTMLDivElement, HTMLDivElement>(
    open,
    {
      align: 'start',
      maxHeight: 480,
      minSpace: 220,
      offset: 6,
      measureKey: `${filtered.length}:${loading}`,
    }
  )
  const changeOpen = (next: boolean) => {
    if (next) {
      setQuery('')
      setHighlighted(0)
    }
    setOpen(next)
    onOpenChange?.(next)
  }
  useDismiss(open, [anchorRef, floatingRef], () => changeOpen(false), { captureEscape: true })
  useEffect(() => {
    if (open && window.matchMedia('(min-width: 768px)').matches) {
      searchRef.current?.focus({ preventScroll: true })
    }
  }, [open])
  useEffect(() => {
    setQuery('')
    setHighlighted(0)
    if (listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [resetKey])
  useEffect(() => {
    if (open) {
      optionRefs.current[highlighted]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted, open])
  const select = (model: string) => {
    if (disabled || selectionDisabled) {
      return
    }
    onChange(model)
    changeOpen(false)
    // Return keyboard focus without bringing up a phone's software keyboard.
    const target = anchorRef.current?.querySelector<HTMLElement>(editable ? 'input' : 'button')
    if (window.matchMedia('(min-width: 768px)').matches) {
      target?.focus({ preventScroll: true })
    }
  }
  const navigate = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        changeOpen(true)
      } else {
        setHighlighted((current) =>
          Math.max(0, Math.min(filtered.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
        )
      }
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (filtered[highlighted]) {
        select(filtered[highlighted])
      } else if (editable && query.trim()) {
        select(query.trim())
      }
    }
  }

  return (
    <>
      <div ref={anchorRef} className={clsx(styles.anchor, !editable && styles.headerAnchor)}>
        {editable ? (
          <div className={styles.inputGroup}>
            <input
              id={inputId}
              aria-label={ariaLabel ?? t('channelModel')}
              role="combobox"
              aria-expanded={open}
              aria-controls={`${id}-list`}
              aria-autocomplete="none"
              value={value}
              placeholder={placeholder}
              spellCheck={false}
              disabled={disabled || selectionDisabled}
              onChange={(event) => onChange(event.target.value)}
              onClick={() => {
                if (!open) {
                  changeOpen(true)
                }
              }}
              onKeyDown={navigate}
            />
            <button
              type="button"
              className={styles.arrowButton}
              aria-label={t('modelChoose')}
              aria-haspopup="listbox"
              aria-expanded={open}
              disabled={disabled}
              onClick={() => changeOpen(!open)}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.headerTrigger}
            aria-label={ariaLabel ?? t('channelCurrent')}
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            title={`${subtitle ?? ''} · ${value}`}
            onClick={() => changeOpen(!open)}
          >
            <span className={styles.headerText}>
              <strong>{value || t('channelModelPlaceholder')}</strong>
              {subtitle ? <small>{subtitle}</small> : null}
            </span>
            <IconChevronDownOutline14 />
          </button>
        )}
      </div>
      {open && !disabled
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={{ ...position, visibility: position ? 'visible' : 'hidden' }}
            >
              {menuHeader}
              <div className={styles.searchArea}>
                <div className={styles.heading}>
                  <span>{t('channelModel')}</span>
                  <small>{t('modelAvailableCount', { count: allModels.length })}</small>
                </div>
                <input
                  ref={searchRef}
                  type="search"
                  role="combobox"
                  aria-label={t('modelSearch')}
                  aria-expanded="true"
                  aria-controls={`${id}-list`}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    filtered[highlighted] ? `${id}-option-${highlighted}` : undefined
                  }
                  placeholder={t('modelSearchPlaceholder')}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setHighlighted(0)
                    if (listRef.current) {
                      listRef.current.scrollTop = 0
                    }
                  }}
                  onKeyDown={navigate}
                />
              </div>
              <div
                ref={listRef}
                id={`${id}-list`}
                className={styles.list}
                role="listbox"
                aria-label={t('modelList')}
              >
                {loading ? (
                  <p className={styles.empty} role="status">
                    {t('modelFetching')}
                  </p>
                ) : null}
                {filtered.map((model, index) => (
                  <button
                    ref={(element) => {
                      optionRefs.current[index] = element
                    }}
                    key={model}
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={model === value}
                    disabled={selectionDisabled}
                    title={model}
                    className={clsx(styles.option, highlighted === index && styles.highlighted)}
                    onMouseMove={() => setHighlighted(index)}
                    onClick={() => select(model)}
                  >
                    <span>{model}</span>
                    {model === value ? <IconCheckOutline16 /> : null}
                  </button>
                ))}
                {!filtered.length && !loading ? (
                  <p className={styles.empty}>
                    {t(query ? 'modelNoResults' : 'channelModelsEmpty')}
                  </p>
                ) : null}
              </div>
              {editable && query.trim() && !allModels.includes(query.trim()) ? (
                <button
                  type="button"
                  className={styles.manual}
                  disabled={selectionDisabled}
                  onClick={() => select(query.trim())}
                >
                  {t('modelUseManual', { model: query.trim() })}
                </button>
              ) : null}
              {menuFooter}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
