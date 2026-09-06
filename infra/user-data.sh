#!/usr/bin/env bash
set -euo pipefail

exec > >(tee /var/log/greenhouse-bootstrap.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg jq unzip nvme-cli

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

snap start amazon-ssm-agent || snap install amazon-ssm-agent --classic
systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service
systemctl restart snap.amazon-ssm-agent.amazon-ssm-agent.service

cat >/etc/sysctl.d/99-greenhouse.conf <<'EOF'
fs.file-max = 2097152
fs.nr_open = 2097152
net.netfilter.nf_conntrack_max = 1048576
net.ipv4.ip_local_port_range = 1024 65535
EOF
sysctl --system

cat >/usr/local/sbin/prepare-greenhouse-volume <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
expected_serial="${data_volume_id}"
device=""
for _ in $(seq 1 120); do
  device=$(lsblk -ndo NAME,SERIAL | awk -v expected="$expected_serial" '$2 == expected { print "/dev/" $1; exit }')
  [[ -n "$device" ]] && break
  sleep 2
done
[[ -n "$device" ]] || { echo "Greenhouse EBS volume was not attached" >&2; exit 1; }

if ! blkid "$device" >/dev/null 2>&1; then
  mkfs.ext4 -L greenhouse-data "$device"
fi

install -d -m 0755 /opt/greenhouse
uuid=$(blkid -s UUID -o value "$device")
grep -q "UUID=$uuid " /etc/fstab || echo "UUID=$uuid /opt/greenhouse ext4 defaults,nofail 0 2" >> /etc/fstab
mountpoint -q /opt/greenhouse || mount /opt/greenhouse
install -d -m 0711 /opt/greenhouse/docker

systemctl stop docker || true
cat >/etc/docker/daemon.json <<JSON
{
  "data-root": "/opt/greenhouse/docker",
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
JSON
EOF
chmod 0755 /usr/local/sbin/prepare-greenhouse-volume

cat >/etc/systemd/system/greenhouse-volume.service <<'EOF'
[Unit]
Description=Prepare persistent Greenhouse Docker data volume
After=local-fs.target
Before=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/prepare-greenhouse-volume
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable greenhouse-volume.service
systemctl start greenhouse-volume.service
systemctl enable docker
systemctl restart docker

docker --version
docker compose version
aws --version
touch /var/lib/greenhouse-bootstrap-complete
