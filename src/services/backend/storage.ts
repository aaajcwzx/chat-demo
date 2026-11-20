import type { Session, SessionSummary } from '../chat/types.js'
import type { StoredFile } from '../chat/db.js'
import { BackendError, backendRequest } from './client.js'
import { storageOwner } from './state.js'

type StoredSession = { session: Session; revision: number }
type CloudSummary = SessionSummary & { revision: number }
const revisions = new Map<string, number>()
const summaryRevisions = new Map<string, number>()
const writes = new Map<string, Promise<void>>()
export const cloudWaitForWrites = async (owner: number) => {
  await Promise.all(
    [...writes.entries()].filter(([id]) => id.startsWith(`${owner}:`)).map(([, task]) => task)
  )
}
const key = (owner: number, id: string) => `${owner}:${id}`
export const currentRevision = (owner: number, id: string) => revisions.get(key(owner, id))
export const remoteRevision = (owner: number, id: string) => summaryRevisions.get(key(owner, id))

const queueWrite = (owner: number, id: string, run: () => Promise<void>): Promise<void> => {
  const idKey = key(owner, id)
  const task = (writes.get(idKey) ?? Promise.resolve()).catch(() => {}).then(run)
  writes.set(idKey, task)
  void task
    .finally(() => {
      if (writes.get(idKey) === task) {
        writes.delete(idKey)
      }
    })
    .catch(() => {})
  return task
}
export const fileForm = (
  files: StoredFile[],
  names?: Map<string, { name: string; mimeType: string }>
) => {
  const form = new FormData()
  form.append(
    'fileMetadata',
    JSON.stringify(
      files.map((file) => ({
        id: file.id,
        name: names?.get(file.id)?.name ?? file.id,
        mimeType: names?.get(file.id)?.mimeType ?? file.blob.type,
      }))
    )
  )
  for (const file of files) {
    form.append(`file:${file.id}`, file.blob, file.id)
  }
  return form
}
export const cloudList = async (owner: number): Promise<SessionSummary[]> => {
  const result = await backendRequest<{ list: CloudSummary[] }>('/sessions', {}, owner)
  for (const row of result.list) {
    summaryRevisions.set(key(owner, row.id), row.revision)
  }
  return result.list.map(({ id, title, createdAt, updatedAt }) => ({
    id,
    title,
    createdAt,
    updatedAt,
  }))
}
export const cloudGet = async (owner: number, id: string): Promise<Session | undefined> => {
  try {
    const result = await backendRequest<StoredSession>(
      `/sessions/${encodeURIComponent(id)}`,
      {},
      owner
    )
    revisions.set(key(owner, id), result.revision)
    return result.session
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) {
      return undefined
    }
    throw error
  }
}
export const cloudSave = (owner: number, session: Session, files: StoredFile[] = []) =>
  queueWrite(owner, session.id, async () => {
    const path = `/sessions/${encodeURIComponent(session.id)}`
    const headers = new Headers({ 'If-Match': String(revisions.get(key(owner, session.id)) ?? 0) })
    let body: BodyInit
    if (files.length) {
      const names = new Map(
        session.messages.flatMap((message) =>
          message.role === 'user'
            ? message.files.map(
                (file) => [file.id, { name: file.name, mimeType: file.mimeType }] as const
              )
            : []
        )
      )
      const form = fileForm(files, names)
      form.append('session', JSON.stringify(session))
      body = form
    } else {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(session)
    }
    const result = await backendRequest<StoredSession>(
      path,
      { method: 'PUT', headers, body },
      owner
    )
    revisions.set(key(owner, session.id), result.revision)
  })
export const cloudRename = (owner: number, id: string, title: string) =>
  queueWrite(owner, id, async () => {
    await backendRequest(
      `/sessions/${encodeURIComponent(id)}/title`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      },
      owner
    )
    await cloudGet(owner, id)
  })
export const cloudDelete = async (owner: number, id: string) => {
  await (writes.get(key(owner, id)) ?? Promise.resolve()).catch(() => {})
  try {
    await backendRequest(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }, owner)
  } catch (error) {
    if (!(error instanceof BackendError && error.status === 404)) {
      throw error
    }
  }
  revisions.delete(key(owner, id))
}
export const cloudReadFile = async (owner: number, id: string): Promise<Blob | undefined> => {
  if (owner !== storageOwner()) {
    throw new BackendError(409, '登录账号已变化')
  }
  const response = await fetch(`/api/chat/files/${encodeURIComponent(id)}`, {
    headers: { 'X-Chat-Owner': String(owner) },
  })
  if (response.status === 404) {
    return undefined
  }
  if (!response.ok) {
    throw new BackendError(response.status, '无法读取服务器附件')
  }
  if (owner !== storageOwner()) {
    throw new BackendError(409, '登录账号已变化')
  }
  const blob = await response.blob()
  if (owner !== storageOwner()) { throw new BackendError(409, '登录账号已变化') }
  return blob
}
export const cloudSaveFiles = async (owner: number, files: StoredFile[]) => {
  await backendRequest('/files', { method: 'POST', body: fileForm(files) }, owner)
}
export const cloudImport = async (
  owner: number,
  sessions: Session[],
  files: StoredFile[],
  replace = false
) => {
  const names = new Map(
    sessions.flatMap((session) =>
      session.messages.flatMap((message) =>
        message.role === 'user'
          ? message.files.map(
              (file) => [file.id, { name: file.name, mimeType: file.mimeType }] as const
            )
          : []
      )
    )
  )
  const form = fileForm(files, names)
  form.append('sessions', JSON.stringify(sessions))
  form.append('replace', String(replace))
  await backendRequest('/history/import', { method: 'POST', body: form }, owner)
  for (const session of sessions) {
    revisions.delete(key(owner, session.id))
  }
  return cloudList(owner)
}
