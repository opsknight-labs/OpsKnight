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

{{- define "opsknight.roleLabels" -}}
{{ include "opsknight.selectorLabels" . }}
opsknight-role: {{ .role }}
{{- end }}

{{- define "opsknight.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "opsknight.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "opsknight.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository (.Values.image.digest | trimPrefix "@") -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end }}

{{- define "opsknight.secretName" -}}
{{- default (printf "%s-secrets" (include "opsknight.fullname" .)) .Values.secrets.existingSecret | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "opsknight.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "opsknight.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "opsknight.postgresql.serviceName" -}}
{{- printf "%s-postgresql" (include "opsknight.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "opsknight.pgbouncer.fullname" -}}
{{- printf "%s-pgbouncer" (include "opsknight.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "opsknight.directHost" -}}
{{- if .Values.postgresql.enabled -}}
{{- include "opsknight.postgresql.serviceName" . -}}
{{- else -}}
{{- required "postgresql.host is required when postgresql.enabled=false and database.url is not used" .Values.postgresql.host -}}
{{- end -}}
{{- end }}

{{/* Legacy/integrated URL retains current behavior. */}}
{{- define "opsknight.databaseUrl" -}}
{{- if .Values.database.url }}
{{- .Values.database.url }}
{{- else }}
{{- $host := include "opsknight.directHost" . }}
{{- printf "postgresql://%s:%s@%s:%s/%s?schema=public&connection_limit=%d&pool_timeout=%d" (.Values.postgresql.username | urlquery) (.Values.postgresql.password | urlquery) $host .Values.postgresql.port .Values.postgresql.database (int .Values.postgresql.connectionLimit) (int .Values.postgresql.poolTimeout) }}
{{- end }}
{{- end }}

{{- define "opsknight.webDatabaseUrl" -}}
{{- if and .Values.pgbouncer.enabled .Values.database.url }}
{{- fail "pgbouncer.enabled cannot be combined with database.url; configure structured postgresql.host/port/database/username/password values so PgBouncer can reach the backend safely" }}
{{- end }}
{{- if .Values.database.url }}
{{- .Values.database.url }}
{{- else }}
{{- $host := include "opsknight.directHost" . }}
{{- $port := .Values.postgresql.port }}
{{- if .Values.pgbouncer.enabled }}
{{- $host = include "opsknight.pgbouncer.fullname" . }}
{{- $port = printf "%d" (int .Values.pgbouncer.port) }}
{{- end }}
{{- printf "postgresql://%s:%s@%s:%s/%s?schema=public&connection_limit=%d&pool_timeout=%d" (.Values.postgresql.username | urlquery) (.Values.postgresql.password | urlquery) $host $port .Values.postgresql.database (int .Values.web.database.connectionLimit) (int .Values.web.database.poolTimeout) }}
{{- end }}
{{- end }}

{{- define "opsknight.workerDatabaseUrl" -}}
{{- if .Values.database.url }}
{{- .Values.database.url }}
{{- else }}
{{- $host := include "opsknight.directHost" . }}
{{- printf "postgresql://%s:%s@%s:%s/%s?schema=public&connection_limit=%d&pool_timeout=%d" (.Values.postgresql.username | urlquery) (.Values.postgresql.password | urlquery) $host .Values.postgresql.port .Values.postgresql.database (int .Values.worker.database.connectionLimit) (int .Values.worker.database.poolTimeout) }}
{{- end }}
{{- end }}

{{- define "opsknight.schedulerDatabaseUrl" -}}
{{- if .Values.database.url }}
{{- .Values.database.url }}
{{- else }}
{{- $host := include "opsknight.directHost" . }}
{{- printf "postgresql://%s:%s@%s:%s/%s?schema=public&connection_limit=%d&pool_timeout=%d" (.Values.postgresql.username | urlquery) (.Values.postgresql.password | urlquery) $host .Values.postgresql.port .Values.postgresql.database (int .Values.scheduler.database.connectionLimit) (int .Values.scheduler.database.poolTimeout) }}
{{- end }}
{{- end }}
