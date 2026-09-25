.PHONY: up build-app rebuild logs ps db-up down

up: ## sobe banco + app (build quando preciso)
	docker compose up --build -d

build-app: ## rebuilda SÓ a imagem do app, sem tocar no banco
	docker compose build app

rebuild: build-app ## rebuilda o app e reinicia só o container dele
	docker compose up -d app

logs: ## acompanha o log do app
	docker compose logs -f app

ps: ## status + uptime dos containers
	docker compose ps

db-up: ## sobe SÓ o banco 
	docker compose up -d db

down: ## derruba tudo (os dados ficam no volume pgdata)
	docker compose down