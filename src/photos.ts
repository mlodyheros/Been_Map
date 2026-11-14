import { useEffect, useState } from 'react'

/**
 * Trip photos. They are kept on this device only, in the browser's own
 * database: scaled down when added, so ten of them per trip stay small.
 */

const DB = 'been-map'
const STORE = 'photos'
const MAX_SIDE = 1600

let opening: Promise<IDBDatabase> | null = null
function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error) => {
    opening = null // private mode, or storage refused: allow another try later
    throw error
  })
  return opening
}

const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) => {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = work(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error)
  })
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done(): void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() }
    } catch {
      // some browsers decode more formats through <img>
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, done: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Stores a scaled-down copy of the picture and returns its id. Throws when the file is not a picture the browser can read. */
export async function addPhoto(file: Blob): Promise<string> {
  const { source, width, height, done } = await decode(file)
  if (!width || !height) throw new Error('empty image')
  const k = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * k))
  canvas.height = Math.max(1, Math.round(height * k))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  // JPEG has no transparency: see-through pictures get a white ground rather than black
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  done()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) throw new Error('could not encode image')
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  await run('readwrite', (store) => store.put(blob, id))
  return id
}

const urls = new Map<string, Promise<string | null>>()

/** An address the picture can be shown from, or null when this device does not have it. */
export function photoUrl(id: string): Promise<string | null> {
  let url = urls.get(id)
  if (!url) {
    url = run<Blob | undefined>('readonly', (store) => store.get(id)).then(
      (blob) => (blob ? URL.createObjectURL(blob) : null),
      () => null,
    )
    urls.set(id, url)
  }
  return url
}

export async function removePhotos(ids: readonly string[]) {
  if (!ids.length) return
  for (const id of ids) {
    const url = urls.get(id)
    urls.delete(id)
    url?.then((u) => u && URL.revokeObjectURL(u))
  }
  try {
    const db = await database()
    const tx = db.transaction(STORE, 'readwrite')
    for (const id of ids) tx.objectStore(STORE).delete(id)
  } catch {
    // nothing stored, nothing to remove
  }
}

/** undefined while loading, null when the picture is not on this device. */
export function usePhoto(id: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    setUrl(undefined)
    photoUrl(id).then((u) => current && setUrl(u))
    return () => {
      current = false
    }
  }, [id])
  return url
}
