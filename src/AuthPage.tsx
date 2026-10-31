import { useState, type FormEvent } from 'react'
import { ArrowLeft, KeyRound, Mail, Sparkles, UserRound } from 'lucide-react'
import { isSupabaseConfigured, supabase, supabaseConfigurationError } from './lib/supabase'

type AuthMode = 'login' | 'register' | 'reset' | 'update'

export default function AuthPage({ onBack, onAuthenticated, initialMode = 'login' }: {
  onBack: () => void
  onAuthenticated: (successMessage?: string) => void
  initialMode?: AuthMode
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) {
      setError('Account sign-in is not configured yet. Add the Supabase URL and publishable key to the environment.')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'register') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name.trim(), phone: phone.trim() || null },
          },
        })
        if (signUpError) throw signUpError
        const session = data.session ?? (await supabase.auth.getSession()).data.session
        if (!session) {
          setMessage('Your account was created, but Supabase did not return an authenticated session. Check the email confirmation setting, then sign in.')
          return
        }
        if (!data.user || session.user.id !== data.user.id) {
          throw new Error('Supabase returned a session that does not match the newly registered customer.')
        }
        const { data: profile, error: profileError } = await supabase.from('profiles')
          .update({ full_name: name.trim(), phone: phone.trim() || null })
          .eq('id', session.user.id)
          .select('id, full_name, email, phone')
          .single()
        if (profileError) throw profileError
        if (profile.id !== session.user.id || profile.full_name !== name.trim() || profile.email !== session.user.email || profile.phone !== (phone.trim() || null)) {
          throw new Error('Your account was created, but the saved customer profile did not match the submitted details.')
        }
        onAuthenticated('Account created successfully')
      } else if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (signInError) throw signInError
        onAuthenticated()
      } else if (mode === 'reset') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        })
        if (resetError) throw resetError
        setMessage('If an account exists for this address, a password reset link is on its way.')
      } else {
        const { error: updateError } = await supabase.auth.updateUser({ password })
        if (updateError) throw updateError
        setMessage('Your password has been updated.')
        onAuthenticated()
      }
    } catch (reason) {
      if (import.meta.env.DEV) console.error('HappiXO account request failed.', reason)
      setError(reason instanceof Error ? reason.message : 'HappiXO could not complete that account request.')
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'register' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : mode === 'update' ? 'Choose a new password' : 'Welcome back'

  return <main className="auth-page">
    <header className="auth-topbar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onBack() }}><span className="brand-mark"><Sparkles size={17} /></span> happi<span>xo</span></a>
      <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> Back to HappiXO</button>
    </header>
    <section className="auth-card">
      <div className="auth-mark"><Sparkles size={19} /></div>
      <div className="eyebrow">YOUR CELEBRATIONS, ALL IN ONE PLACE</div>
      <h1>{title}</h1>
      <p className="auth-description">{mode === 'register' ? 'Create a private workspace for your event plans.' : mode === 'reset' ? 'We’ll email you a secure password reset link.' : mode === 'update' ? 'Use a new password to secure your HappiXO account.' : 'Sign in to see and continue planning your saved events.'}</p>
      <form className="auth-form" onSubmit={submit}>
        {mode === 'register' && <>
          <label htmlFor="auth-name">Full name</label>
          <div className="auth-input"><UserRound size={16} /><input id="auth-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={120} /></div>
          <label htmlFor="auth-phone">Phone <span>Optional</span></label>
          <div className="auth-input"><span className="auth-phone-icon">+</span><input id="auth-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" maxLength={40} /></div>
        </>}
        {mode !== 'update' && <>
          <label htmlFor="auth-email">Email</label>
          <div className="auth-input"><Mail size={16} /><input id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={320} /></div>
        </>}
        {mode !== 'reset' && <>
          <label htmlFor="auth-password">Password</label>
          <div className="auth-input"><KeyRound size={16} /><input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'register' || mode === 'update' ? 'new-password' : 'current-password'} required minLength={8} /></div>
        </>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <button className="button button-dark auth-submit" disabled={busy || !supabase}>{busy ? 'Please wait…' : mode === 'register' ? 'Create my account' : mode === 'reset' ? 'Send reset link' : mode === 'update' ? 'Update password' : 'Sign in'}</button>
      </form>
      <div className="auth-links">
        {mode === 'login' && <><button onClick={() => { setMode('reset'); setMessage(''); setError('') }}>Forgot password?</button><span>New to HappiXO?</span><button onClick={() => { setMode('register'); setMessage(''); setError('') }}>Create an account</button></>}
        {mode === 'register' && <><span>Already have an account?</span><button onClick={() => { setMode('login'); setMessage(''); setError('') }}>Sign in</button></>}
        {mode === 'reset' && <button onClick={() => { setMode('login'); setMessage(''); setError('') }}>Back to sign in</button>}
        {mode === 'update' && <button onClick={onBack}>Cancel</button>}
      </div>
      {!supabase && <p className="auth-setup-note">{supabaseConfigurationError || (isSupabaseConfigured ? 'Supabase configuration is invalid. Check the project environment settings.' : <>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to enable authentication.</>)}</p>}
    </section>
  </main>
}
