import { createClient } from '@supabase/supabase-js'
import { cleanExtras, storedExtras, type Extras } from './extras'
import { cleanPeople, cleanStatuses, type Statuses } from './model'

// The publishable key is meant to ship in the browser; row-level security in
// supabase/schema.sql decides what each signed-in user can read and write.
const SUPABASE_URL = 'https://ppvlltouaxmnjalcinuq.supabase.co'
const SUPABASE_KEY = 'sb_publishable_ee1WjwL3LYFfNY5AxsJRCw_Gy9uaeUi'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

export interface Account {
  id: string
  username: string
}

export interface CloudMap {
  statuses: Statuses
  people: Set<string>
  /** Places, regions and notes. Personal maps only; shared maps have none. */
  extras?: Extras
}

export interface Friend {
  /** Friendship row id. */
  id: number
  userId: string
  username: string
  state: 'friend' | 'incoming' | 'outgoing'
}

export type CloudErrorCode =
  | 'credentials'
  | 'emailTaken'
  | 'usernameTaken'
  | 'usernameInvalid'
  | 'passwordShort'
  | 'unconfirmed'
  | 'notFound'
  | 'self'
  | 'exists'
  | 'setup'
  | 'unknown'

export class CloudError extends Error {
  constructor(
    public code: CloudErrorCode,
    detail?: string,
  ) {
    super(detail ?? code)
  }
}

function fail(error: { message: string; code?: string }): never {
  const text = error.message.toLowerCase()
  if (text.includes('invalid login')) throw new CloudError('credentials')
  if (text.includes('already registered')) throw new CloudError('emailTaken')
  if (text.includes('not confirmed')) throw new CloudError('unconfirmed')
  if (text.includes('password should be')) throw new CloudError('passwordShort')
  if (error.code === '23505') throw new CloudError('exists')
  // tables or the sign-up trigger are missing: schema.sql has not been run yet
  const missing = ['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883']
  if (missing.includes(error.code ?? '') || text.includes('database error')) {
    throw new CloudError('setup', error.message)
  }
  throw new CloudError('unknown', error.message)
}

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

/** Resolves to true when the account is ready, false when the e-mail still has to be confirmed. */
export async function signUp(email: string, password: string, username: string) {
  const name = username.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(name)) throw new CloudError('usernameInvalid')
  const free = await supabase.rpc('username_available', { name })
  if (free.error) fail(free.error)
  if (!free.data) throw new CloudError('usernameTaken')

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username: name }, emailRedirectTo: location.origin + location.pathname },
  })
  if (error) fail(error)
  // with e-mail confirmation on, an existing address comes back as a user without identities
  if (data.user && data.user.identities?.length === 0) throw new CloudError('emailTaken')
  return Boolean(data.session)
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) fail(error)
}

export type Provider = 'google' | 'apple'

/** Sign-in services switched on in the Supabase project, so only working buttons are shown. */
export async function oauthProviders(): Promise<Provider[]> {
  try {
    const settings = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } }).then((r) =>
      r.json(),
    )
    return (['google', 'apple'] as const).filter((p) => settings?.external?.[p] === true)
  } catch {
    return []
  }
}

/** Leaves the page for the provider's sign-in and comes back signed in. */
export async function signInWith(provider: Provider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: location.origin + location.pathname },
  })
  if (error) fail(error)
}

/** Accounts made through Google or Apple pick their username after the first sign-in. */
export async function claimUsername(username: string) {
  const name = username.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(name)) throw new CloudError('usernameInvalid')
  const { error } = await supabase.rpc('claim_username', { name })
  if (error?.code === '23505') throw new CloudError('usernameTaken')
  if (error) fail(error)
  // the session carries the username from here on
  const saved = await supabase.auth.updateUser({ data: { username: name } })
  if (saved.error) fail(saved.error)
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function fetchMap(userId: string): Promise<CloudMap | null> {
  const { data, error } = await supabase.from('maps').select('*').eq('user_id', userId).maybeSingle()
  if (error) fail(error)
  return data
    ? { statuses: cleanStatuses(data.statuses), people: cleanPeople(data.people), extras: cleanExtras(data.extras) }
    : null
}

/** False once the database turned out to predate places, regions and notes (schema.sql not re-run yet). */
let extrasStored = true

export async function saveMap(userId: string, map: CloudMap) {
  const row = {
    user_id: userId,
    statuses: map.statuses,
    people: [...map.people],
    updated_at: new Date().toISOString(),
  }
  if (extrasStored && map.extras) {
    const { error } = await supabase.from('maps').upsert({ ...row, extras: storedExtras(map.extras) })
    if (!error) return
    // an older database has no such column: keep syncing the countries at least
    if (error.code !== 'PGRST204' && !error.message.includes('extras')) fail(error)
    extrasStored = false
  }
  const { error } = await supabase.from('maps').upsert(row)
  if (error) fail(error)
}

/** Someone's map by username, if they switched their public link on. Works signed out. */
export async function fetchPublicMap(username: string): Promise<(CloudMap & { username: string }) | null> {
  const { data, error } = await supabase.rpc('public_map', { name: username })
  if (error) fail(error)
  return data
    ? {
        username: String(data.username),
        statuses: cleanStatuses(data.statuses),
        people: cleanPeople(data.people),
        extras: cleanExtras(data.extras),
      }
    : null
}

export async function isPublic(userId: string) {
  const { data, error } = await supabase.from('profiles').select('is_public').eq('id', userId).maybeSingle()
  if (error) fail(error)
  return Boolean(data?.is_public)
}

export async function setPublic(userId: string, on: boolean) {
  const { error } = await supabase.from('profiles').update({ is_public: on }).eq('id', userId)
  if (error) fail(error)
}

export async function listFriends(userId: string): Promise<Friend[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select(
      'id, status, requester, addressee, from:profiles!friendships_requester_fkey(username), to:profiles!friendships_addressee_fkey(username)',
    )
  if (error) fail(error)
  type Row = {
    id: number
    status: string
    requester: string
    addressee: string
    from: { username: string } | null
    to: { username: string } | null
  }
  return (data as unknown as Row[])
    .map((row): Friend => {
      const mine = row.requester === userId
      return {
        id: row.id,
        userId: mine ? row.addressee : row.requester,
        username: (mine ? row.to : row.from)?.username ?? '?',
        state: row.status === 'accepted' ? 'friend' : mine ? 'outgoing' : 'incoming',
      }
    })
    .sort((a, b) => a.username.localeCompare(b.username))
}

export async function sendRequest(userId: string, username: string) {
  const name = username.trim().replace(/^@/, '').toLowerCase()
  const found = await supabase.from('profiles').select('id').eq('username', name).maybeSingle()
  if (found.error) fail(found.error)
  if (!found.data) throw new CloudError('notFound')
  if (found.data.id === userId) throw new CloudError('self')
  const { error } = await supabase.from('friendships').insert({ requester: userId, addressee: found.data.id })
  if (error) fail(error)
}

export async function acceptRequest(id: number) {
  const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
  if (error) fail(error)
}

/** Declines a request, cancels one you sent, or removes a friend. */
export async function removeFriendship(id: number) {
  const { error } = await supabase.from('friendships').delete().eq('id', id)
  if (error) fail(error)
}

export interface SharedMapInfo {
  id: string
  name: string
  /** True when the signed-in user created the map and may delete it. */
  mine: boolean
  members: { userId: string; username: string }[]
}

export async function listSharedMaps(userId: string): Promise<SharedMapInfo[]> {
  const { data, error } = await supabase
    .from('shared_maps')
    .select('id, name, created_by, members:shared_map_members(user_id, profile:profiles(username))')
    .order('name')
  if (error) fail(error)
  type Row = {
    id: string
    name: string
    created_by: string
    members: { user_id: string; profile: { username: string } | null }[]
  }
  return (data as unknown as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    mine: row.created_by === userId,
    members: row.members
      .map((m) => ({ userId: m.user_id, username: m.profile?.username ?? '?' }))
      .sort((a, b) => a.username.localeCompare(b.username)),
  }))
}

export async function createSharedMap(name: string) {
  const { error } = await supabase.rpc('create_shared_map', { map_name: name })
  if (error) fail(error)
}

export async function deleteSharedMap(id: string) {
  const { error } = await supabase.from('shared_maps').delete().eq('id', id)
  if (error) fail(error)
}

export async function addSharedMember(mapId: string, userId: string) {
  const { error } = await supabase.from('shared_map_members').insert({ map_id: mapId, user_id: userId })
  if (error) fail(error)
}

/** Leaves a shared map, or (as its creator) removes someone from it. */
export async function removeSharedMember(mapId: string, userId: string) {
  const { error } = await supabase.from('shared_map_members').delete().eq('map_id', mapId).eq('user_id', userId)
  if (error) fail(error)
}

export async function fetchSharedMap(id: string): Promise<CloudMap | null> {
  const { data, error } = await supabase.from('shared_maps').select('statuses, people').eq('id', id).maybeSingle()
  if (error) fail(error)
  return data ? { statuses: cleanStatuses(data.statuses), people: cleanPeople(data.people) } : null
}

export async function markShared(mapId: string, country: string, status: string | null) {
  const { error } = await supabase.rpc('mark_shared_map', { map: mapId, country, new_status: status })
  if (error) fail(error)
}

export async function flagShared(mapId: string, country: string, known: boolean) {
  const { error } = await supabase.rpc('flag_shared_map', { map: mapId, country, known })
  if (error) fail(error)
}

/** Calls `onChange` whenever someone marks the shared map. Returns a function that stops listening. */
export function watchSharedMap(id: string, onChange: (map: CloudMap) => void) {
  const channel = supabase
    .channel(`shared-map-${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'shared_maps', filter: `id=eq.${id}` },
      (payload) => onChange({ statuses: cleanStatuses(payload.new.statuses), people: cleanPeople(payload.new.people) }),
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
