{ buildGoModule, cloudflared, makeWrapper, lib, ... }:

buildGoModule {
  pname = "dl_conn";
  version = "0.1.0";

  src = ./.;
  subPackages = [ "cmd/dl_conn" ];
  vendorHash = "sha256-PtqvWNYsB0bY1/URcNs3od/hSj4NI/vdxSyPDEymgDw=";

  nativeBuildInputs = [ cloudflared makeWrapper ];

  postInstall = ''
    wrapProgram $out/bin/dl_conn \
      --prefix PATH : ${lib.makeBinPath [ cloudflared ]}
  '';

  meta = with lib; {
    description = "Go daemon exposing local services via Cloudflare Tunnel + Nostr signaling";
    mainProgram = "dl_conn";
    platforms = platforms.linux;
  };
}
