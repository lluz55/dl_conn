{ buildGoModule, cloudflared, makeWrapper, lib, ... }:

buildGoModule {
  pname = "dl_conn";
  version = "0.1.0";

  src = ./.;
  subPackages = [ "cmd/dl_conn" ];
  vendorHash = "sha256-M/TVeX2l4H4bp5ZhmpFqdahpaVuziUapfYzOYVrjmnU=";

  nativeBuildInputs = [ cloudflared makeWrapper ];

  # Bundle the SPA so the package is self-contained: web/ is the frontend the
  # daemon serves via http.FileServer, and shipping it inside $out/share/web
  # means `nixos-rebuild switch` alone keeps the dashboard in lockstep with
  # the Go binary — no manual `rsync` to the StateDirectory after each bump.
  # The daemon looks at DL_CONN_WEB_DIR first and falls back to ./web for the
  # local dev flow (`go run ./cmd/dl_conn` from the worktree).
  postInstall = ''
    mkdir -p $out/share
    cp -r $src/web $out/share/web
    wrapProgram $out/bin/dl_conn \
      --prefix PATH : ${lib.makeBinPath [ cloudflared ]}
  '';

  meta = with lib; {
    description = "Go daemon exposing local services via Cloudflare Tunnel + Nostr signaling";
    mainProgram = "dl_conn";
    platforms = platforms.linux;
  };
}
