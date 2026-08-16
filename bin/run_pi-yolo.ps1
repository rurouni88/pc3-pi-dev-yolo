# Only uncomment if you want to clear previous sessions
# Remove-Item -Path "C:\GIT\AI\pi-sandbox\.pi\sessions\*" -Recurse -Force -ErrorAction SilentlyContinue

docker run --rm -it `
  --network=host `
  --cap-drop=ALL `
  --security-opt=no-new-privileges `
  -v "C:\GIT\AI\pi-sandbox:/workspace" `
  -v "C:\GIT\AI\pi-sandbox\.pi:/root/.pi/agent" `