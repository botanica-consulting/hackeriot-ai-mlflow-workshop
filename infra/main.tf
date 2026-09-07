locals {
  tags = merge({
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }, var.resource_tags)

  participant_ids = [for i in range(1, var.participant_count + 1) : format("%02d", i)]
  greenhouse_hosts = {
    for id in local.participant_ids : "app-${id}" => "greenhouse-${id}.${var.domain}"
  }
}

data "aws_vpc" "default" {
  count   = var.vpc_id == null ? 1 : 0
  default = true
}

locals {
  selected_vpc_id = var.vpc_id != null ? var.vpc_id : data.aws_vpc.default[0].id
}

data "aws_subnets" "public" {
  count = var.subnet_id == null ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.selected_vpc_id]
  }

  filter {
    name   = "map-public-ip-on-launch"
    values = ["true"]
  }
}

locals {
  selected_subnet_id = var.subnet_id != null ? var.subnet_id : sort(data.aws_subnets.public[0].ids)[0]
}

data "aws_subnet" "selected" {
  id = local.selected_subnet_id
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_ecr_repository" "app" {
  name                 = var.ecr_repository_name
  image_tag_mutability = "IMMUTABLE_WITH_EXCLUSION"
  force_delete         = false

  image_tag_mutability_exclusion_filter {
    filter      = "latest"
    filter_type = "WILDCARD"
  }

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Always retain the currently deployed image tagged latest"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["latest"]
          countType      = "imageCountMoreThan"
          countNumber    = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire images not protected by latest after 30 days"
        selection = {
          tagStatus   = "any"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 30
        }
        action = { type = "expire" }
      }
    ]
  })
}

resource "aws_secretsmanager_secret" "environment" {
  name                    = var.secret_name
  description             = "Shared dotenv configuration for the greenhouse workshop containers"
  recovery_window_in_days = 7
  tags                    = local.tags
}

resource "aws_iam_role" "ec2" {
  name = "${var.project_name}-ec2-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "secret_read" {
  name = "read-workshop-environment"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.environment.arn
    }]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2.name
  tags = local.tags
}

resource "aws_security_group" "app" {
  name        = "${var.project_name}-sg"
  description = "No ingress; outbound access for SSM, ECR, AI providers, and Cloudflare Tunnel"
  vpc_id      = local.selected_vpc_id
  tags        = local.tags
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "Required outbound application and tunnel traffic"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_ebs_volume" "data" {
  availability_zone = data.aws_subnet.selected.availability_zone
  type              = "gp3"
  size              = var.data_volume_size
  encrypted         = true
  tags              = merge(local.tags, { Name = "${var.project_name}-data" })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "app" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  iam_instance_profile        = aws_iam_instance_profile.ec2.name
  vpc_security_group_ids      = [aws_security_group.app.id]
  subnet_id                   = local.selected_subnet_id
  associate_public_ip_address = true
  user_data_replace_on_change = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size
    delete_on_termination = true
    encrypted             = true
  }

  user_data = templatefile("${path.module}/user-data.sh", {
    data_volume_id = replace(aws_ebs_volume.data.id, "-", "")
  })

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  tags = merge(local.tags, { Name = "${var.project_name}-instance" })

  # Bootstrap changes apply to newly created hosts. Redeploy application changes
  # through SSM so editing user-data does not replace the active workshop host.
  lifecycle {
    ignore_changes = [user_data]
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "greenhouse" {
  account_id = var.cloudflare_account_id
  name       = var.tunnel_name
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "greenhouse" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.greenhouse.id
  source     = "cloudflare"

  config = {
    ingress = concat(
      [for hostname in values(local.greenhouse_hosts) : {
        hostname = hostname
        service  = "http://traefik:80"
      }],
      [{ service = "http_status:404" }]
    )
  }
}

resource "cloudflare_dns_record" "greenhouse" {
  for_each = local.greenhouse_hosts

  zone_id = var.cloudflare_zone_id
  name    = each.value
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.greenhouse.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
  comment = "Greenhouse workshop ${each.key}; managed by Terraform"
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "greenhouse" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.greenhouse.id
}
