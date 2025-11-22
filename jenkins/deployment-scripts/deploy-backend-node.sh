#!/bin/bash
set -e

sudo systemctl stop backend-node || true

sudo rsync -a --delete backend-node/ /opt/backend-node/
cd /opt/backend-node
sudo npm ci --production

sudo systemctl start backend-node
