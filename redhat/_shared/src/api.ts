export type ApiClientConfig = {
  baseUrl: string
  tokenFn: () => Promise<string>
  headers?: Record<string, string>
  maxRetries?: number
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

export function createApiClient(config: ApiClientConfig): ApiClient {
  const maxRetries = config.maxRetries ?? 1

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
      const token = await config.tokenFn()
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        ...config.headers,
      }

      const init: RequestInit = { method, headers }
      if (options?.body !== undefined) {
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify(options.body)
      }

      response = await fetch(url, init)

      if (response.status !== 401) {
        break
      }
    }

    const resp = response!

    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`HTTP ${resp.status}: ${body}`)
    }

    const data = (await resp.json()) as T
    return { data, status: resp.status, headers: resp.headers }
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
