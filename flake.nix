{
  description = "dl_conn — Go daemon exposing local services via Cloudflare Tunnel + Nostr signaling";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      systemOutputs = flake-utils.lib.eachDefaultSystem (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          dlConnPkg = pkgs.callPackage ./dl-conn.nix { cloudflared = pkgs.cloudflared; };
        in
        {
          devShells.default = pkgs.mkShell {
            buildInputs = with pkgs; [
              go
              gopls
              golangci-lint
              cloudflared
              git
            ];
          };

          packages = {
            default = dlConnPkg;
            dl_conn = dlConnPkg;
          };

          apps = {
            default = flake-utils.lib.mkApp { drv = dlConnPkg; };
            dl_conn = flake-utils.lib.mkApp { drv = dlConnPkg; };
          };
        }
      );

      nixosModule = import ./nixos/module.nix { inherit self; };
    in
    systemOutputs // {
      overlays.default = final: prev: {
        dl_conn = self.packages.${final.stdenv.hostPlatform.system}.default;
      };

      nixosModules = {
        default = nixosModule;
        dl_conn = nixosModule;
        "dl-conn" = nixosModule;
      };

      nixosModule = nixosModule;
    };
}

