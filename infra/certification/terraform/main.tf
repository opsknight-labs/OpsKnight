terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Ephemeral   = "true"
      Commit      = var.git_commit
      Owner       = "OpsKnight"
      TTL         = "${var.ttl_hours}h"
      Project     = "Phase4-Certification"
    }
  }
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_key_pair" "certification" {
  count      = var.ssh_public_key != "" ? 1 : 0
  key_name   = "opsknight-cert-${var.git_commit}"
  public_key = var.ssh_public_key
}

resource "aws_security_group" "certification" {
  name_prefix = "opsknight-phase4-cert-"
  description = "Security group for Phase 4 disposable certification environment"
  vpc_id      = data.aws_vpc.default.id

  # SSH
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "SSH administration"
  }

  # OpsKnight Web
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "OpsKnight Web Application"
  }

  # HTTP / Reverse Proxy
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "HTTP ingress"
  }

  # HTTPS / Reverse Proxy
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "HTTPS ingress"
  }

  # Mailpit Web UI & API
  ingress {
    from_port   = 8025
    to_port     = 8025
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "Mailpit test SMTP UI and API"
  }

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
    description      = "Unrestricted egress for container pulls and package updates"
  }
}

locals {
  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    echo "=== OpsKnight Phase 4 Certification Instance Setup ==="

    # Fail-safe auto termination based on TTL
    SHUTDOWN_MINUTES=$(( ${var.ttl_hours} * 60 ))
    echo "Scheduling automatic shutdown in $SHUTDOWN_MINUTES minutes as cost fail-safe"
    shutdown -h +$SHUTDOWN_MINUTES "Automatic TTL expiration for disposable certification instance" &

    # Update packages and install Docker
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg lsb-release jq

    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    systemctl enable docker
    systemctl start docker

    usermod -aG docker ubuntu

    # Prepare certification workspace
    mkdir -p /opt/opsknight-certification
    chown -R ubuntu:ubuntu /opt/opsknight-certification

    echo "=== OpsKnight Setup Complete ==="
  EOF
}

resource "aws_instance" "certification_spot" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.instance_types[0]
  subnet_id     = data.aws_subnets.default.ids[0]

  key_name               = length(aws_key_pair.certification) > 0 ? aws_key_pair.certification[0].key_name : null
  vpc_security_group_ids = [aws_security_group.certification.id]

  instance_market_options {
    market_type = "spot"
    spot_options {
      spot_instance_type             = "one-time"
      instance_interruption_behavior = "terminate"
    }
  }

  root_block_device {
    volume_size           = var.volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  user_data = local.user_data

  tags = {
    Name = "opsknight-phase4-cert-${var.git_commit}"
  }
}
