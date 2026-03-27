# Ops Dashboard Systemd Unit

Use the bundled unit files to run the dashboard under systemd instead of a shell-launched `node` process.

## Install

If you have sudo on the host:

```bash
sudo install -m 644 /home/tom/code/ops-dashboard/systemd/ops-dashboard.service /etc/systemd/system/ops-dashboard.service
sudo systemctl daemon-reload
sudo systemctl enable --now ops-dashboard.service
sudo systemctl status ops-dashboard.service --no-pager
```

If you want a user service instead:

```bash
mkdir -p ~/.config/systemd/user
cp /home/tom/code/ops-dashboard/systemd/ops-dashboard.user.service ~/.config/systemd/user/ops-dashboard.service
systemctl --user daemon-reload
systemctl --user enable --now ops-dashboard.service
systemctl --user status ops-dashboard.service --no-pager
```

## Notes

- The unit pins the dashboard to:
  - `APP_HOST=10.10.0.2`
  - `PORT=1717`
  - `BACKEND_BASE_URL=http://10.10.0.2:1717`
  - `OPENCLAW_BIN=/home/tom/.nvm/versions/node/v24.12.0/bin/openclaw`
- If you want the service to survive logout in user mode, enable lingering on the host:

```bash
sudo loginctl enable-linger tom
```
