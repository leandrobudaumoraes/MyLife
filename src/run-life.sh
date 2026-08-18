#!/bin/bash

# Carrega o perfil do usuário para garantir que ferramentas como NVM ou o path do Node estejam acessíveis
source ~/.bashrc

# Navega até o diretório do projeto para garantir que o .env seja lido corretamente
cd /home/usuario/Documentos/MyLife

# Executa o script e salva o output em um arquivo de log para debug futuro
npx tsx src/test-run.ts >> logs/cron.log 2>&1