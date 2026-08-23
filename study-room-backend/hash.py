
import bcrypt

print(bcrypt.hashpw(b'qwerty228', bcrypt.gensalt(12)).decode())

