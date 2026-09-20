output "instance_id" {
  description = "EC2 Instance ID"
  value       = aws_instance.certification_spot.id
}

output "public_ip" {
  description = "Public IPv4 address of the certification instance"
  value       = aws_instance.certification_spot.public_ip
}

output "public_dns" {
  description = "Public DNS hostname of the certification instance"
  value       = aws_instance.certification_spot.public_dns
}

output "spot_bid_status" {
  description = "Spot request state"
  value       = aws_instance.certification_spot.spot_instance_request_id
}

output "app_url" {
  description = "Base URL of the certified OpsKnight deployment"
  value       = "http://${aws_instance.certification_spot.public_ip}:3000"
}

output "mailpit_url" {
  description = "Base URL of the Mailpit web UI and API"
  value       = "http://${aws_instance.certification_spot.public_ip}:8025"
}

output "ssh_command" {
  description = "Command to connect via SSH"
  value       = "ssh -o StrictHostKeyChecking=no ubuntu@${aws_instance.certification_spot.public_ip}"
}
