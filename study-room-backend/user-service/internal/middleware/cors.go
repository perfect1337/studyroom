package middleware

import "net/http"

// CORS позволяет обращаться к сервису из браузера с фронтенда, который
// раздаётся с другого origin (например, Vite dev-server на localhost:5173,
// либо прод-домен фронтенда). Токен передаётся через заголовок Authorization,
// а не через cookie, поэтому credentials-режим не обязателен — но мы всё
// равно отражаем конкретный Origin (а не "*"), чтобы это работало и в тех
// браузерах/клиентах, которые всё же шлют запрос с credentials: "include".
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
		w.Header().Set("Access-Control-Max-Age", "600")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
