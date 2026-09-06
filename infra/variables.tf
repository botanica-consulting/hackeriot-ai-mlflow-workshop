variable "aws_profile" {
  description = "Local AWS CLI profile used by Terraform and deployment scripts."
  type        = string
  default     = "default"
}

variable "aws_region" {
  description = "AWS region for EC2, ECR, and Secrets Manager."
  type        = string
  default     = "eu-central-1"
}

variable "project_name" {
  description = "Prefix used for managed resources."
  type        = string
  default     = "greenhouse-workshop"
}

variable "environment" {
  description = "Deployment environment tag."
  type        = string
  default     = "workshop"
}

variable "instance_type" {
  description = "EC2 instance type. 64 GiB memory is recommended for 50 participants."
  type        = string
  default     = "r7i.2xlarge"
}

variable "vpc_id" {
  description = "VPC ID. When null, the region's default VPC is used."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Public subnet ID. When null, the first sorted public subnet in the selected VPC is used."
  type        = string
  default     = null
}

variable "root_volume_size" {
  description = "Root volume size in GiB."
  type        = number
  default     = 40
}

variable "data_volume_size" {
  description = "Persistent Docker/MLflow data volume size in GiB."
  type        = number
  default     = 100
}

variable "ecr_repository_name" {
  description = "ECR repository for the workshop app image."
  type        = string
  default     = "greenhouse-workshop-app"
}

variable "secret_name" {
  description = "Secrets Manager secret that will contain the shared dotenv file."
  type        = string
  default     = "greenhouse-workshop/environment"
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID containing the botanica.tools zone."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for botanica.tools."
  type        = string
}

variable "domain" {
  description = "Cloudflare-managed base domain."
  type        = string
  default     = "botanica.tools"
}

variable "participant_count" {
  description = "Number of isolated participant app and MLflow pairs."
  type        = number
  default     = 50

  validation {
    condition     = var.participant_count >= 1 && var.participant_count <= 200
    error_message = "participant_count must be between 1 and 200."
  }
}

variable "tunnel_name" {
  description = "Cloudflare Tunnel name."
  type        = string
  default     = "greenhouse-workshop"
}

variable "resource_tags" {
  description = "Additional tags for AWS resources."
  type        = map(string)
  default     = {}
}
