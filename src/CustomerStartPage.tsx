import { useState, type FormEvent } from 'react'
import { ArrowLeft, Mail, Phone, Sparkles, UserRound } from 'lucide-react'
import { createCustomerSession, type CustomerDetails } from './lib/customer'

export default function CustomerStartPage({ onBack, onCustomerReady }: {
  onBack: () => void
  onCustomerReady: (customer: CustomerDetails) => void
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { customer } = await createCustomerSession({
        fullName: fullName.trim(),
        email: email.trim(),
        mobileNumber: mobileNumber.trim(),
      })
      onCustomerReady(customer)
    } catch (reason) {
      if (import.meta.env.DEV) console.error('Could not securely save the HappiXO customer enquiry.')
      setError(reason instanceof Error ? reason.message : 'HappiXO could not save your details. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-page">
    <header className="auth-topbar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onBack() }}><span className="brand-mark"><Sparkles size={17} /></span> happi<span>xo</span></a>
      <button className="text-button" onClick={onBack}><ArrowLeft size={15} /> Back to HappiXO</button>
    </header>
    <section className="auth-card">
      <div className="auth-mark"><Sparkles size={19} /></div>
      <div className="eyebrow">YOUR CELEBRATIONS, ALL IN ONE PLACE</div>
      <h1>Let’s start planning</h1>
      <p className="auth-description">Share a few details so we can save your event plans to this browser session.</p>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="customer-full-name">Full name</label>
        <div className="auth-input"><UserRound size={16} /><input id="customer-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required maxLength={120} /></div>
        <label htmlFor="customer-email">Email address</label>
        <div className="auth-input"><Mail size={16} /><input id="customer-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={320} /></div>
        <label htmlFor="customer-mobile">Mobile number</label>
        <div className="auth-input"><Phone size={16} /><input id="customer-mobile" type="tel" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} autoComplete="tel" required maxLength={24} pattern="\+?[0-9\(\) .\-]{7,24}" title="Enter a valid mobile number." /></div>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-dark auth-submit" disabled={busy}>{busy ? 'Saving your details…' : 'Start Planning'}</button>
      </form>
      <p className="auth-setup-note">This is guest planning, not an account. Your private session is saved in this browser; your email and phone are contact details, not proof of identity. Use a device you trust.</p>
    </section>
  </main>
}
