#!/bin/bash
set -e

sudo rm -rf /var/www/html/*
sudo cp -r frontend/* /var/www/html/
sudo chown -R www-data:www-data /var/www/html
sudo systemctl restart apache2
