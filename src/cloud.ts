import { createClient } from '@supabase/supabase-js'
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
  const missing = ['PGRST202', 'PGRST205', '42P01', '42883']
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

export async function signOut() {
  await supabase.auth.signOut()
}

export async function fetchMap(userId: string): Promise<CloudMap | null> {
  const { data, error } = await supabase.from('maps').select('statuses, people').eq('user_id', userId).maybeSingle()
  if (error) fail(error)
  return data ? { statuses: cleanStatuses(data.statuses), people: cleanPeople(data.people) } : null
}

export async function saveMap(userId: string, map: CloudMap) {
  const { error } = await supabase.from('maps').upsert({
    user_id: userId,
    statuses: map.statuses,
    people: [...map.people],
    updated_at: new Date().toISOString(),
  })
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
