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

{{- define "opsknight.roleSelectorLabels" -}}
{{ include "opsknight.selectorLabels" .root }}
app.kubernetes.io/component: {{ .role }}
{{- end }}

{{- define "opsknight.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "opsknight.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Resolve an immutable digest when supplied, otherwise use tag/appVersion. */}}
{{- define "opsknight.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository (.Values.image.digest | trimPrefix "@") -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end }}

{{- define "opsknight.pgbouncer.image" -}}
{{- if .Values.pgbouncer.image.digest -}}
{{- printf "%s@%s" .Values.pgbouncer.image.repository (.Values.pgbouncer.image.digest | trimPrefix "@") -}}
{{- else -}}
{{- printf "%s:%s" .Values.pgbouncer.image.repository .Values.pgbouncer.image.tag -}}
{{- end -}}
{{- end }}

{{- define "opsknight.agent.image" -}}
{{- if .Values.agent.image.digest -}}
{{- printf "%s@%s" .Values.agent.image.repository (.Values.agent.image.digest | trimPrefix "@") -}}
{{- else -}}
{{- printf "%s:%s" .Values.agent.image.repository (required "Set agent.image.digest or an explicitly tested agent.image.tag" .Values.agent.image.tag) -}}
{{- end -}}
{{- end }}

{{- define "opsknight.agent.serviceAccountName" -}}
{{- if .Values.agent.serviceAccount.create -}}
{{- default (printf "%s-agent" (include "opsknight.fullname" .)) .Values.agent.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.agent.serviceAccount.name -}}
{{- end -}}
{{- end }}

