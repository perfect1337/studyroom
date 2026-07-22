package openapi

import (
	"embed"
	"net/http"
)

//go:embed openapi.yaml swagger.html
var content embed.FS

func SpecHandler(w http.ResponseWriter, r *http.Request) {
	data, err := content.ReadFile("openapi.yaml")
	if err != nil {
		http.Error(w, "could not read OpenAPI spec", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/x-yaml")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

func DocsHandler(w http.ResponseWriter, r *http.Request) {
	data, err := content.ReadFile("swagger.html")
	if err != nil {
		http.Error(w, "could not read Swagger UI page", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}
