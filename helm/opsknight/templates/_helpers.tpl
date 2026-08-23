{{/* Expand the name of the chart. */}}
{{- define "opsknight.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Create a default fully qualified app name. */}}
{{- define "opsknight.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "opsknight.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "opsknight.labels" -}}
helm.sh/chart: {{ include "opsknight.chart" . }}
{{ include "opsknight.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "opsknight.selectorLabels" -}}
app.kubernetes.io/name: {{ include "opsknight.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "opsknight.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "opsknight.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "opsknight.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "opsknight.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "opsknight.postgresql.serviceName" -}}
{{- printf "%s-postgresql" (include "opsknight.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Database URL. A complete database.url takes precedence so managed PostgreSQL,
TLS options, PgBouncer, and URI-encoded credentials can be supplied safely.
*/}}
{{- define "opsknight.databaseUrl" -}}
{{- if .Values.database.url }}
{{- .Values.database.url }}
{{- else }}
{{- $connLimit := default 40 .Values.postgresql.connectionLimit }}
{{- $poolTimeout := default 30 .Values.postgresql.poolTimeout }}
{{- $host := .Values.postgresql.host }}
{{- if .Values.postgresql.enabled }}
{{- $host = include "opsknight.postgresql.serviceName" . }}
{{- end }}
{{- printf "postgresql://%s:%s@%s:%s/%s?schema=public&connection_limit=%d&pool_timeout=%d" (.Values.postgresql.username | urlquery) (.Values.postgresql.password | urlquery) $host .Values.postgresql.port .Values.postgresql.database (int $connLimit) (int $poolTimeout) }}
{{- end }}
{{- end }}
