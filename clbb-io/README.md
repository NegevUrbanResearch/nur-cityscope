# Backend CLBB

Una vez clonado este proyeto se debe ejecutar el siguiente comando para iniciar los contenedores:

`docker-compose up -d --build`

Una vez que las imagenes se descarguen y el proyecto se genere, se deben aplicar las migraciones, para esto ejecutamos el siguiente comando:

`docker exec -it clbb_web python manage.py migrate`

Para poder hacer las migraciones se debe usar el siguiente comando:

`docker exec -it clbb_web python manage.py makemigrations`

Luego debemos crear un super usuario para nuestro backend, para eso ejecutamos el siguiente comando y seguir las instrucciones de la linea de comando:

`docker exec -it clbb_web python manage.py createsuperuser`

Con este usuario podemos entrar al panel de administracion de django, la ruta para poder acceder es:

`http://localhost:8500/admin`

En caso de necesitar abri un puerto en windows, la regla usada para dar acceso a los servicios que el pc tiene corriendo fue:

`New-NetFirewallRule -DisplayName "$SERVICE_NAME" -Direction Inbound -LocalPort $SERVICE_PORT -Protocol TCP -Action Allow`

# Captura de imagen

## *Para que el equipo que captura la imagen envie se comunique con el pc que tiene los servicios corriendo deben tener la misma base de datos, mas abajo se dejan las instrucciones para la duplicación.*

Para la captura de las imagenes se usa un ambiente virtual, para su creacion se debe asegurar tener instalado virtualenv, en caso de no tener el paquete, instalar con el siguiente comando:

`python3 install virtualenv`

Luego para la creacion del ambiente virtual se debe acceder en la terminar a la siguiente ruta y ejecutar:

`cd $PATH_TO_PROJECT/camera/`
`python3 -m venv clbb`

Una vez el ambiente creado, si se esta usando Windows, usar:

`clbb\Scripts\activate`

Para usuarios Unix:

`source clbb/bin/activate`

Con el ambiente virtual activado, instalar librerias:

`pip install -r requirements.txt`

Para comenzar a capturar con las camaras se debe ejecutar el comando:

`python3 capture.py`

## Export base de datos 

Ejecucion en server:

`docker exec -it clbb_db pg_dump -U postgres -W -h clbb_db clbb > clbb_db.sql`


## Import base de datos

`docker exec -i clbb_db psql clbb -U postgres -c "DROP SCHEMA public CASCADE;CREATE SCHEMA public;GRANT ALL ON SCHEMA public TO postgres;"`
`docker exec -i clbb_db psql clbb -U postgres < clbb_db.sql`




