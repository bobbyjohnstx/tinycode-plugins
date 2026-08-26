export type ApiClientConfig = {
  baseUrl: string
  tokenFn: () => Promise<string | null>
  headers?: Record<string, string>
  maxRetries?: number
  timeoutMs?: number
}

export type ApiResponse<T> = {
  data: T
  status: number
  headers: Headers
}

export type ApiClient = {
  get<T = unknown>(path: string, query?: Record<string, string>): Promise<ApiResponse<T>>
  post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>
  put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>
  delete<T = unknown>(path: string): Promise<ApiResponse<T>>
}

const TRANSIENT_CODES = ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return TRANSIENT_CODES.some(code =>
    error.message.includes(code) || ("code" in error && (error as { code: string }).code === code)
  )
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const maxRetries = config.maxRetries ?? 1
  const timeout = config.timeoutMs ?? 30_000

  async function request<T>(
    method: string,
    path: string,
    options?: { body?: unknown; query?: Record<string, string> },
  ): Promise<ApiResponse<T>> {
    let url = `${config.baseUrl}${path}`
    if (options?.query) {
      url += `?${new URLSearchParams(options.query).toString()}`
    }

    let response: Response | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const token = await config.tokenFn()
        const headers: Record<string, string> = {
          ...config.headers,
        }
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }

        const init: RequestInit = { method, headers }
        if (options?.body !== undefined) {
          headers["Content-Type"] = "application/json"
          init.body = JSON.stringify(options.body)
        }

        response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(timeout),
        })

        if (response.status !== 401) {
          break
        }
      } catch (error: unknown) {
        if (!isTransientError(error) || attempt === maxRetries) {
          throw new Error(
            `Network error after ${attempt + 1} attempt(s): ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    }

    if (!response) {
      throw new Error(`No response received after ${maxRetries + 1} attempts`)
    }

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`HTTP ${response.status}: ${body}`)
    }

    const contentType = response.headers.get("content-type") ?? ""
    if (!contentType.includes("application/json")) {
      const body = await response.text()
      throw new Error(
        `Expected JSON response but received ${contentType || "unknown content type"}. ` +
        `Body: ${body.slice(0, 500)}`
      )
    }

    const data = (await response.json()) as T
    return { data, status: response.status, headers: response.headers }
  }

  return {
    get<T = unknown>(path: string, query?: Record<string, string>): Promise<ApiResponse<T>> {
      return request<T>("GET", path, { query })
    },

    post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
      return request<T>("POST", path, { body })
    },

    put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
      return request<T>("PUT", path, { body })
    },

    delete<T = unknown>(path: string): Promise<ApiResponse<T>> {
      return request<T>("DELETE", path)
    },
  }
}
