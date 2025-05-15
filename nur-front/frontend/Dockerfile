FROM node:18-alpine

# Establecer directorio de trabajo
WORKDIR /app

# Copiar y construir
COPY package*.json ./
RUN npm install
COPY . .

# Especificar el comando que se ejecutará al iniciar el contenedor
CMD ["npm", "run", "build"]