import { useCallback, useEffect, useState } from 'react'
import {
  CloudError,
  acceptRequest,
  claimUsername,
  isPublic,
  oauthProviders,
  setPublic,
  signInWith,
  type Provider,
  addSharedMember,
  createSharedMap,
  deleteSharedMap,
  listSharedMaps,
  removeSharedMember,
  listFriends,
  removeFriendship,
  sendRequest,
  signIn,
  signOut,
  signUp,
  type Account as AccountInfo,
  type Friend,
  type SharedMapInfo,
} from './cloud'
import { STRINGS, type Lang } from './i18n'

interface Props {
  lang: Lang
  account: AccountInfo | null
  onViewFriend(friend: Friend): Promise<void>
  onOpenShared(map: SharedMapInfo): Promise<void>
}

export default function Account({ lang, account, onViewFriend, onOpenShared }: Props) {
  const t = STRINGS[lang].account
  const explain = (e: unknown) => t.errors[e instanceof CloudError ? e.code : 'unknown']

  return (
    <div className="dialog account">
      {account && !account.username ? (
        <ChooseUsername lang={lang} explain={explain} />
      ) : account ? (
        <Friends lang={lang} account={account} explain={explain} onViewFriend={onViewFriend} onOpenShared={onOpenShared} />
      ) : (
        <SignIn lang={lang} explain={explain} />
      )}
    </div>
  )
}

/** Accounts that came in through Google or Apple have no username yet. */
function ChooseUsername({ lang, explain }: { lang: Lang; explain(e: unknown): string }) {
  const t = STRINGS[lang].account
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await claimUsername(username)
      // the session update re-renders this as the friends view
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>{t.chooseTitle}</h2>
      <p className="dialog-note">{t.chooseHelp}</p>
      <form onSubmit={submit}>
        <label>
          {t.username}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <small>{t.usernameHelp}</small>
        </label>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? t.working : t.chooseSave}
        </button>
        <button type="button" className="link" onClick={signOut}>
          {t.logOut}
        </button>
      </form>
    </>
  )
}

/** The switch that lets anyone with the link see the map, and the link itself. */
function PublicLink({ lang, account, explain }: { lang: Lang; account: AccountInfo; explain(e: unknown): string }) {
  const t = STRINGS[lang].account
  const [on, setOn] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const link = `${location.origin}${location.pathname}?u=${account.username}`

  useEffect(() => {
    let current = true
    isPublic(account.id).then(
      (value) => current && setOn(value),
      () => current && setOn(false),
    )
    return () => {
      current = false
    }
  }, [account.id])

  const flip = async () => {
    const next = !on
    setOn(next)
    setNote('')
    try {
      await setPublic(account.id, next)
    } catch (err) {
      setOn(!next)
      setNote(explain(err))
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setNote(t.copied)
    } catch {
      setNote(link) // no clipboard access: show it so it can be copied by hand
    }
  }

  return (
    <>
      <h3>{t.publicTitle}</h3>
      <p className="dialog-note">{t.publicHelp}</p>
      <label className="toggle">
        <input type="checkbox" checked={Boolean(on)} disabled={on === null} onChange={flip} />
        <span>{t.publicOn}</span>
      </label>
      {on && (
        <p className="public-link">
          <code>{link}</code>
          <button className="chip chip-strong" onClick={copy}>
            {t.copyLink}
          </button>
        </p>
      )}
      {note && <p className="dialog-note">{note}</p>}
    </>
  )
}

function SignIn({ lang, explain }: { lang: Lang; explain(e: unknown): string }) {
  const t = STRINGS[lang].account
  const [mode, setMode] = useState<'logIn' | 'signUp'>('logIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState('')
  const [providers, setProviders] = useState<Provider[]>([])

  useEffect(() => {
    let current = true
    oauthProviders().then((list) => current && setProviders(list))
    return () => {
      current = false
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'logIn') await signIn(email, password)
      else if (!(await signUp(email, password, username))) setConfirm(email)
      // on success the session change re-renders this dialog as the friends view
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  if (confirm) return <p className="dialog-note">{t.confirmEmail(confirm)}</p>

  return (
    <>
      <h2>{t.title}</h2>
      <p className="dialog-note">{t.pitch}</p>
      {providers.length > 0 && (
        <div className="providers">
          {providers.map((p) => (
            <button key={p} className="provider" onClick={() => signInWith(p).catch((err) => setError(explain(err)))}>
              {t[p]}
            </button>
          ))}
          <span>{t.or}</span>
        </div>
      )}
      <div className="switch dialog-switch" role="radiogroup">
        {(['logIn', 'signUp'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => (setMode(m), setError(''))}>
            {t[m]}
          </button>
        ))}
      </div>
      <form onSubmit={submit}>
        {mode === 'signUp' && (
          <label>
            {t.username}
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              spellCheck={false}
              required
            />
            <small>{t.usernameHelp}</small>
          </label>
        )}
        <label>
          {t.email}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          {t.password}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'logIn' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? t.working : mode === 'logIn' ? t.submitLogIn : t.submitSignUp}
        </button>
      </form>
    </>
  )
}

function Friends({
  lang,
  account,
  explain,
  onViewFriend,
  onOpenShared,
}: {
  lang: Lang
  account: AccountInfo
  explain(e: unknown): string
  onViewFriend(friend: Friend): Promise<void>
  onOpenShared(map: SharedMapInfo): Promise<void>
}) {
  const t = STRINGS[lang].account
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [maps, setMaps] = useState<SharedMapInfo[] | null>(null)
  const [mapName, setMapName] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [people, shared] = await Promise.all([listFriends(account.id), listSharedMaps(account.id)])
      setFriends(people)
      setMaps(shared)
    } catch (err) {
      setFriends((current) => current ?? [])
      setMaps((current) => current ?? [])
      setError(explain(err))
    }
    // explain is left out on purpose: it changes with the language, the list doesn't
  }, [account.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  /** Runs one friendship action, then reloads the list. */
  const act = async (action: () => Promise<void>, done = '') => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(done)
      await refresh()
    } catch (err) {
      setError(explain(err))
    } finally {
      setBusy(false)
    }
  }

  const invite = (e: React.FormEvent) => {
    e.preventDefault()
    const target = name.trim().replace(/^@/, '').toLowerCase()
    if (!target) return
    act(async () => {
      await sendRequest(account.id, target)
      setName('')
    }, t.sent(target))
  }

  const createMap = (e: React.FormEvent) => {
    e.preventDefault()
    const title = mapName.trim()
    if (!title) return
    act(async () => {
      await createSharedMap(title)
      setMapName('')
    })
  }

  const group = (state: Friend['state']) => friends?.filter((f) => f.state === state) ?? []
  const incoming = group('incoming')
  const outgoing = group('outgoing')
  const accepted = group('friend')

  return (
    <>
      <h2>{t.title}</h2>
      <p className="dialog-me">
        <span>
          {t.signedInAs} <strong>@{account.username}</strong>
        </span>
        <button className="link" onClick={signOut}>
          {t.logOut}
        </button>
      </p>

      <h3>{t.friends}</h3>
      <form className="invite" onSubmit={invite}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.addPlaceholder}
          aria-label={t.addPlaceholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="primary" disabled={busy || !name.trim()}>
          {t.add}
        </button>
      </form>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="dialog-note">{notice}</p>}

      {incoming.length > 0 && (
        <>
          <h4>{t.incoming}</h4>
          <ul className="people">
            {incoming.map((f) => (
              <li key={f.id}>
                <span>@{f.username}</span>
                <button className="chip chip-strong" disabled={busy} onClick={() => act(() => acceptRequest(f.id))}>
                  {t.accept}
                </button>
                <button className="chip" disabled={busy} onClick={() => act(() => removeFriendship(f.id))}>
                  {t.decline}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {friends && accepted.length === 0 && incoming.length === 0 && outgoing.length === 0 && !error && (
        <p className="dialog-note">{t.noFriends}</p>
      )}
      <ul className="people">
        {accepted.map((f) => (
          <li key={f.id}>
            <span>@{f.username}</span>
            <button className="chip chip-strong" disabled={busy} onClick={() => act(() => onViewFriend(f))}>
              {t.viewMap}
            </button>
            <button className="chip" disabled={busy} onClick={() => act(() => removeFriendship(f.id))}>
              {t.remove}
            </button>
          </li>
        ))}
      </ul>

      {outgoing.length > 0 && (
        <>
          <h4>{t.outgoing}</h4>
          <ul className="people">
            {outgoing.map((f) => (
              <li key={f.id}>
                <span>@{f.username}</span>
                <button className="chip" disabled={busy} onClick={() => act(() => removeFriendship(f.id))}>
                  {t.cancel}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>{t.shared}</h3>
      <p className="dialog-note">{t.sharedHelp}</p>
      <form className="invite" onSubmit={createMap}>
        <input
          value={mapName}
          onChange={(e) => setMapName(e.target.value)}
          placeholder={t.sharedName}
          aria-label={t.sharedName}
          maxLength={40}
        />
        <button className="primary" disabled={busy || !mapName.trim()}>
          {t.create}
        </button>
      </form>
      {maps && maps.length === 0 && <p className="dialog-note">{t.noShared}</p>}
      <ul className="people shared">
        {maps?.map((m) => {
          const invitable = accepted.filter((f) => !m.members.some((x) => x.userId === f.userId))
          return (
            <li key={m.id}>
              <span>
                {m.name}
                <small>{m.members.map((x) => `@${x.username}`).join(', ')}</small>
              </span>
              <button className="chip chip-strong" disabled={busy} onClick={() => act(() => onOpenShared(m))}>
                {t.openMap}
              </button>
              {invitable.length > 0 && (
                <select
                  className="chip"
                  value=""
                  disabled={busy}
                  aria-label={t.addFriend}
                  onChange={(e) => {
                    const userId = e.target.value
                    if (userId) act(() => addSharedMember(m.id, userId))
                  }}
                >
                  <option value="">{t.addFriend}</option>
                  {invitable.map((f) => (
                    <option key={f.userId} value={f.userId}>
                      @{f.username}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="chip"
                disabled={busy}
                onClick={() => act(() => (m.mine ? deleteSharedMap(m.id) : removeSharedMember(m.id, account.id)))}
              >
                {m.mine ? t.delete : t.leave}
              </button>
            </li>
          )
        })}
      </ul>

      <PublicLink lang={lang} account={account} explain={explain} />
    </>
  )
}
