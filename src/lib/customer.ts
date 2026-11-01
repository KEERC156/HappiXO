export type CustomerDetails = {
  id: string
  fullName: string
  email: string
  mobileNumber: string
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    throw new Error(import.meta.env.DEV
      ? 'Could not reach the HappiXO customer API. Start the app with `npm run dev` from the project folder, then try again.'
      : 'Could not reach HappiXO customer service. Check your connection and try again.')
  }
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `HappiXO customer service failed (${response.status}).`
    throw new Error(message)
  }
  return payload as T
}

export function getCustomerSession(): Promise<{ customer: CustomerDetails | null }> {
  return request('/api/customer/session')
}

export function createCustomerSession(details: Omit<CustomerDetails, 'id'>): Promise<{ customer: CustomerDetails }> {
  return request('/api/customer/session', 'POST', details)
}

export function updateCustomerSession(details: Pick<CustomerDetails, 'fullName' | 'mobileNumber'>): Promise<{ customer: CustomerDetails }> {
  return request('/api/customer/session', 'PUT', details)
}

export function endCustomerSession(): Promise<void> {
  return request('/api/customer/session', 'DELETE')
}
