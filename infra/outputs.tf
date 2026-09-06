output "instance_id" {
  value       = aws_instance.app.id
  description = "EC2 instance managed through SSM."
}

output "instance_public_ip" {
  value       = aws_instance.app.public_ip
  description = "Public IP used only for outbound connectivity; the security group has no ingress."
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.app.repository_url
  description = "ECR repository for immutable app images."
}

output "environment_secret_arn" {
  value       = aws_secretsmanager_secret.environment.arn
  description = "Secrets Manager ARN read by the EC2 redeploy script."
}

output "cloudflare_tunnel_id" {
  value       = cloudflare_zero_trust_tunnel_cloudflared.greenhouse.id
  description = "Cloudflare Tunnel ID."
}

output "cloudflare_tunnel_token" {
  value       = data.cloudflare_zero_trust_tunnel_cloudflared_token.greenhouse.token
  description = "Sensitive connector token copied into Secrets Manager by configure-secret.sh."
  sensitive   = true
}

output "first_participant_url" {
  value = "https://greenhouse-01.${var.domain}"
}

output "last_participant_url" {
  value = "https://greenhouse-${format("%02d", var.participant_count)}.${var.domain}"
}

output "aws_region" {
  value = var.aws_region
}

output "aws_profile" {
  value = var.aws_profile
}

output "domain" {
  value = var.domain
}

output "participant_count" {
  value = var.participant_count
}

output "ssm_session_command" {
  value = "aws ssm start-session --target ${aws_instance.app.id} --region ${var.aws_region} --profile ${var.aws_profile}"
}
