{ self ? null }:
{ config, lib, pkgs, ... }:

with lib;

let
  cfg = config.services.dl-conn;

  yamlFormat = pkgs.formats.yaml {};

  defaultPackage =
    if self != null && self ? packages.${pkgs.stdenv.hostPlatform.system}.default then
      self.packages.${pkgs.stdenv.hostPlatform.system}.default
    else
      pkgs.callPackage ../dl-conn.nix { cloudflared = pkgs.cloudflared; };

  # Generate config YAML if settings are provided and no custom configFile is set
  generatedConfigFile = yamlFormat.generate "dl-conn-config.yaml" cfg.settings;

  finalConfigFile =
    if cfg.configFile != null then
      cfg.configFile
    else
      generatedConfigFile;
in
{
  options.services.dl-conn = {
    enable = mkEnableOption "dl_conn daemon (Cloudflare Tunnel + Nostr Signaling Gateway)";

    package = mkOption {
      type = types.package;
      default = defaultPackage;
      defaultText = literalExpression "pkgs.dl_conn";
      description = mdDoc "The dl_conn package to use.";
    };

    settings = mkOption {
      type = types.attrsOf types.anything;
      default = {};
      description = mdDoc ''
        Declarative configuration for dl_conn. Used to generate the configuration file when `configFile` is not specified.
        See `config.example.yaml` for reference.
      '';
      example = literalExpression ''
        {
          nostr = {
            relays = [
              "wss://relay.damus.io"
              "wss://nos.lol"
              "wss://relay.nostr.band"
              "wss://relay.primal.net"
              "wss://nostr.mom"
            ];
            authorizedNpubs = [
              "npub1pjatm6grg542qqyvtzyyvkd7ehue28rtsjh45ss7008s38ls9zhq5tlw2p"
            ];
          };
          tunnel = {
            listenPort = 9099;
          };
          services = [
            {
              id = "hass";
              name = "Home Assistant";
              prefix = "/hass";
              target = "http://10.0.66.1:8123";
              websocket = true;
            }
          ];
        }
      '';
    };

    configFile = mkOption {
      type = types.nullOr (types.either types.path types.str);
      default = null;
      description = mdDoc "Path to an existing YAML configuration file. If null, configuration is generated from `settings`.";
    };

    secretFile = mkOption {
      type = types.nullOr (types.either types.path types.str);
      default = null;
      description = mdDoc ''
        Path to the Nostr nsec secret file (e.g. from sops-nix or agenix).
        The daemon reads the nsec from this file at runtime via `--nsec-file`.
      '';
      example = "/run/secrets/nostr/dl-conn-key";
    };

    environmentFile = mkOption {
      type = types.nullOr (types.either types.path types.str);
      default = null;
      description = mdDoc "Environment file containing environment variables (e.g. DL_CONN_NOSTR_NSEC).";
    };

    extraArgs = mkOption {
      type = types.listOf types.str;
      default = [];
      description = mdDoc "Extra command-line arguments to pass to dl_conn.";
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.configFile != null || cfg.settings != {};
        message = "services.dl-conn: either `services.dl-conn.configFile` or `services.dl-conn.settings` must be configured.";
      }
    ];

    systemd.services.dl-conn = {
      description = "dl_conn — Cloudflare Tunnel + Nostr Signaling Gateway";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      serviceConfig = {
        ExecStart = ''
          ${cfg.package}/bin/dl_conn \
            --config ${finalConfigFile} \
            ${lib.optionalString (cfg.secretFile != null) "--nsec-file ${toString cfg.secretFile}"} \
            ${lib.escapeShellArgs cfg.extraArgs}
        '';
        Restart = "always";
        RestartSec = "10s";
        ExecReload = "kill -HUP $MAINPID";
        Environment = [
          "PATH=${lib.makeBinPath [ pkgs.cloudflared ]}"
        ];
        EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;

        # Hardening
        DynamicUser = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        StateDirectory = "dl-conn";
        WorkingDirectory = "/var/lib/dl-conn";
        ReadWritePaths = [ "/var/lib/dl-conn" ];
      };
    };
  };
}

