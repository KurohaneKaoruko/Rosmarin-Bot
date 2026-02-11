$ErrorActionPreference = 'Stop'

$manifest = "src-rust/planner_kernel_wasm/Cargo.toml"
$targetWasm = "src-rust/planner_kernel_wasm/target/wasm32-unknown-unknown/release/planner_kernel_wasm.wasm"
$outWasm = "src/modules/wasm/planner_kernel_wasm.wasm"

cargo build --target wasm32-unknown-unknown --release --manifest-path $manifest
Copy-Item -Force $targetWasm $outWasm
Write-Host "WASM built -> $outWasm"
