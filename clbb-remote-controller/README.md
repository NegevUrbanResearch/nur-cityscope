Introduccion 

La aplicacion funciona como aplicacion web, donde se ingresa a la direccion IP del computador que este ejecutando la app

Ejecucion actual 

1. Creacion de la red si no esta creada (IMPORTANTE SI ESTA CREADA NO CREAR)
    docker network create clbb
2. Creacion del contenedor mediante docker compose
    docker compose up -d --build

Ejecucion antigua de la aplicacion en el docker

1. Ceacion de la imagen
    docker build -t magic-button .
2. Creacion del contenerdor
    docker run -d --name magic-button -p 9090:9090 -v $pwd:/magic-button magic-button --network clbb


IMPORTANTE para que pueda funcionar con las demas aplicaciones contenidas en el docker es necesario que el contenedor 
este en la misma red de los otros contenedores a los que se quieren conectar, por el ello el --network 'nombre contenedor'

la ruta /f 
Obtiene el json del servidor con los nombres de los botones y limpia los datos, porque no estan limpios,
los manda a una plantilla y los renderiza,

HTML (botones)
Dentro de botones.html se suben los datos con jinja se hacen los botones dinamicos y se usan dos funciones con js,
cambiarURL(), hace que los botones manden un get al servidor http://192.168.31.120:8500//api/set_map_type/
que cambia los mapas
SS()
Inicia la aplicacion