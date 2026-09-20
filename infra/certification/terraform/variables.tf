variable "aws_region" {
  description = "AWS region for certification instance"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment identifier"
  type        = string
  default     = "phase4-certification"
}

variable "git_commit" {
  description = "Git commit SHA being certified"
  type        = string
  default     = "local-build"
}

variable "ttl_hours" {
  description = "Instance TTL in hours before automatic self-termination"
  type        = number
  default     = 4
}

variable "instance_types" {
  description = "Ordered pool of compatible Spot instance types (4 vCPU / 16 GB RAM minimum)"
  type        = list(string)
  default     = ["m6a.xlarge", "m6i.xlarge", "m7a.xlarge", "c6a.xlarge", "c7a.xlarge"]
}

variable "volume_size_gb" {
  description = "Root disk volume size in GB"
  type        = number
  default     = 50
}

variable "ssh_public_key" {
  description = "Public key for SSH access to the certification instance"
  type        = string
  default     = ""
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks permitted to access the certification environment"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
